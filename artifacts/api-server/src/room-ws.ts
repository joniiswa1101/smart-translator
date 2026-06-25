import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { logger } from "./lib/logger";
import {
  getRoom,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  sendToParticipant,
  getParticipantList,
  cleanupRoom,
  getTargetLang,
  getInstructions,
  type Room,
  type Participant,
  type Turn,
  type Lang,
} from "./room";

const API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

interface WsMessage {
  type: string;
  [key: string]: any;
}

// Create a standalone WebSocket server (no server attached)
export const roomWss = new WebSocketServer({ noServer: true });

roomWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  logger.info({ url: req.url }, "New client connected to room WebSocket");

  let participantId: string | null = null;
  let roomCode: string | null = null;
  let room: Room | null = null;
  let participant: Participant | null = null;

  ws.on("message", (data) => {
    let msg: WsMessage;
    try {
      const text = data instanceof Buffer ? data.toString("utf8") : data;
      msg = JSON.parse(text as string);
    } catch {
      return;
    }

    const type = msg.type;

    if (type === "room.join") {
      const { code, name, role, lang, trainerMode } = msg;
      const targetRoom = getRoom(code);
      if (!targetRoom) {
        ws.send(JSON.stringify({ type: "room.error", error: "Room not found" }));
        return;
      }
      roomCode = code;
      room = targetRoom;
      participantId = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      participant = joinRoom(room, participantId, name, role, lang as Lang, ws);
      // Trainer mode: if trainer joins with trainerMode, set it on the room
      if (role === "trainer" && trainerMode === true) {
        room.trainerMode = true;
      }
      const trainerModeEnabled = room.trainerMode;

      ws.send(JSON.stringify({
        type: "room.joined",
        participantId,
        code: room.code,
        role,
        lang,
        trainerMode: trainerModeEnabled,
        participants: getParticipantList(room),
      }));

      broadcastToRoom(room, {
        type: "room.participant.joined",
        participant: { id: participantId, name, role, lang, active: true },
      }, participantId);

      ensureOpenAIConnection(room);
      return;
    }

    if (!room || !participant || !participantId) {
      ws.send(JSON.stringify({ type: "room.error", error: "Not joined to a room" }));
      return;
    }

    if (type === "audio.append") {
      if (!room.isListening || room.currentSpeaker !== participantId) {
        return;
      }
      if (msg.audio && typeof msg.audio === "string") {
        const buf = Buffer.from(msg.audio, "base64");
        room.audioBuffer.push(buf);
      }
      return;
    }

    if (type === "audio.commit") {
      if (!room.isListening || room.currentSpeaker !== participantId) {
        return;
      }
      commitAudioTurn(room, participant);
      return;
    }

    if (type === "turn.request") {
      // Trainer mode: if trainer requests while busy, cancel current turn and grant
      if (participant.role === "trainer" && room.trainerMode && (room.isListening || room.isProcessing || room.isPlaying)) {
        // Cancel current speaker's turn
        if (room.currentSpeaker && room.currentSpeaker !== participantId) {
          const current = room.participants.get(room.currentSpeaker);
          if (current) {
            cancelTurn(room, current);
          }
        }
      }
      if (room.isListening || room.isProcessing || room.isPlaying) {
        ws.send(JSON.stringify({ type: "turn.rejected", reason: "Busy" }));
        return;
      }

      room.currentSpeaker = participantId;
      room.isListening = true;
      room.audioBuffer = [];
      room.turnId += 1;
      const targetLang = getTargetLang(participant.lang, Array.from(room.participants.values()));
      room.openaiConfig.instructions = getInstructions(participant.lang, targetLang);

      const turn: Turn = {
        turnId: room.turnId,
        speakerId: participantId,
        speakerName: participant.name,
        sourceLang: participant.lang,
        targetLang,
        sourceText: "",
        translationText: "",
        firstByteLatency: null,
        totalGap: null,
        startedAt: Date.now(),
        firstByteAt: null,
        completedAt: null,
      };
      room.currentTurn = turn;
      room.turns.push(turn);

      if (room.openaiWs && room.openaiWs.readyState === WebSocket.OPEN) {
        room.openaiWs.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: room.openaiConfig.instructions,
            audio: { input: { transcription: { model: "whisper-1" }, turn_detection: null } },
          },
        }));
      }

      broadcastToRoom(room, {
        type: "turn.granted",
        turnId: room.turnId,
        speakerId: participantId,
        speakerName: participant.name,
        sourceLang: participant.lang,
        targetLang,
      });

      return;
    }

    if (type === "turn.cancel") {
      if (room.currentSpeaker === participantId) {
        cancelTurn(room, participant);
      }
      return;
    }

    if (type === "room.trainerMode") {
      if (participant.role === "trainer") {
        room.trainerMode = msg.enabled === true;
        broadcastToRoom(room, { type: "room.trainerMode", enabled: room.trainerMode });
        logger.info({ roomCode: room.code, trainerMode: room.trainerMode }, "Trainer mode toggled");
      }
      return;
    }

    if (type === "room.leave") {
      ws.close();
      return;
    }
  });

  ws.on("close", () => {
    if (room && participantId) {
      if (room.currentSpeaker === participantId) {
        cancelTurn(room, participant!);
      }
      leaveRoom(room, participantId);
      broadcastToRoom(room, {
        type: "room.participant.left",
        participantId,
      }, participantId);

      if (room.participants.size === 0) {
        cleanupRoom(room);
      }
    }
    logger.info({ participantId, roomCode }, "Client disconnected from room");
  });

  ws.on("error", (err) => {
    logger.error({ err, participantId, roomCode }, "Room WebSocket error");
  });
});

function ensureOpenAIConnection(room: Room) {
  if (room.openaiWs && room.openaiWs.readyState === WebSocket.OPEN) {
    return;
  }

  const ws = new WebSocket(OPENAI_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  ws.on("open", () => {
    logger.info({ roomCode: room.code }, "OpenAI Realtime connected for room");
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: room.openaiConfig.instructions,
        audio: { input: { transcription: { model: "whisper-1" }, turn_detection: null } },
      },
    }));
  });

  ws.on("message", (data) => {
    let text: string;
    if (data instanceof Buffer) {
      text = data.toString("utf8");
    } else {
      text = String(data);
    }
    try {
      const msg = JSON.parse(text);
      handleOpenAIMessage(room, msg);
    } catch {
      // ignore
    }
  });

  ws.on("error", (err) => {
    logger.error({ err, roomCode: room.code }, "OpenAI Realtime error");
    broadcastToRoom(room, { type: "openai.error", error: err.message });
  });

  ws.on("close", () => {
    logger.info({ roomCode: room.code }, "OpenAI Realtime disconnected");
    room.openaiWs = null;
  });

  room.openaiWs = ws;
}

function handleOpenAIMessage(room: Room, msg: any) {
  if (msg.type === "session.created" || msg.type === "session.updated") {
    return;
  }

  if (msg.type === "response.audio.delta") {
    if (room.isProcessing && room.currentTurn) {
      if (!room.currentTurn.firstByteAt) {
        room.currentTurn.firstByteAt = Date.now();
        room.currentTurn.firstByteLatency = room.currentTurn.firstByteAt - room.currentTurn.startedAt;
      }
      broadcastToRoom(room, {
        type: "response.audio.delta",
        turnId: room.currentTurn.turnId,
        audio: msg.audio,
      });
      if (!room.isPlaying) {
        room.isProcessing = false;
        room.isPlaying = true;
        broadcastToRoom(room, {
          type: "turn.playing",
          turnId: room.currentTurn.turnId,
          speakerId: room.currentTurn.speakerId,
        });
      }
    }
    return;
  }

  if (msg.type === "response.audio.done") {
    if (room.currentTurn) {
      broadcastToRoom(room, {
        type: "response.audio.done",
        turnId: room.currentTurn.turnId,
      });
    }
    return;
  }

  if (msg.type === "conversation.item.input_audio_transcription.completed") {
    if (room.currentTurn) {
      room.currentTurn.sourceText = msg.transcript || "";
      broadcastToRoom(room, {
        type: "turn.source.transcription",
        turnId: room.currentTurn.turnId,
        sourceText: room.currentTurn.sourceText,
      });
    }
    return;
  }

  if (msg.type === "response.output_audio_transcript.done") {
    if (room.currentTurn) {
      room.currentTurn.translationText = msg.transcript || "";
      broadcastToRoom(room, {
        type: "turn.translation.transcription",
        turnId: room.currentTurn.turnId,
        translationText: room.currentTurn.translationText,
      });
    }
    return;
  }

  if (msg.type === "response.done") {
    if (room.currentTurn) {
      room.currentTurn.completedAt = Date.now();
      room.currentTurn.totalGap = room.currentTurn.completedAt - room.currentTurn.startedAt;
      broadcastToRoom(room, {
        type: "turn.completed",
        turnId: room.currentTurn.turnId,
        speakerId: room.currentTurn.speakerId,
        speakerName: room.currentTurn.speakerName,
        sourceLang: room.currentTurn.sourceLang,
        targetLang: room.currentTurn.targetLang,
        sourceText: room.currentTurn.sourceText,
        translationText: room.currentTurn.translationText,
        firstByteLatency: room.currentTurn.firstByteLatency,
        totalGap: room.currentTurn.totalGap,
      });
      room.currentTurn = null;
      room.currentSpeaker = null;
      room.isListening = false;
      room.isProcessing = false;
      room.isPlaying = false;
      room.audioBuffer = [];
    }
    return;
  }

  if (msg.type === "error") {
    logger.error({ error: msg.error, roomCode: room.code }, "OpenAI error");
    broadcastToRoom(room, {
      type: "openai.error",
      error: msg.error?.message || "Unknown error",
    });
    return;
  }
}

function commitAudioTurn(room: Room, participant: Participant) {
  if (!room.openaiWs || room.openaiWs.readyState !== WebSocket.OPEN) {
    logger.warn({ roomCode: room.code }, "OpenAI not connected for commit");
    return;
  }

  const totalLen = room.audioBuffer.reduce((acc, b) => acc + b.length, 0);
  const merged = Buffer.concat(room.audioBuffer, totalLen);
  if (merged.length === 0) {
    return;
  }

  room.isListening = false;
  room.isProcessing = true;

  broadcastToRoom(room, {
    type: "turn.processing",
    turnId: room.currentTurn?.turnId,
    speakerId: participant.id,
  });

  room.openaiWs.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: merged.toString("base64"),
  }));
  room.openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  room.openaiWs.send(JSON.stringify({ type: "response.create" }));
  room.audioBuffer = [];
}

function cancelTurn(room: Room, participant: Participant) {
  if (room.currentSpeaker !== participant.id) {
    return;
  }
  room.currentSpeaker = null;
  room.isListening = false;
  room.isProcessing = false;
  room.isPlaying = false;
  room.audioBuffer = [];
  if (room.currentTurn) {
    room.currentTurn.completedAt = Date.now();
    room.currentTurn.totalGap = null;
  }
  broadcastToRoom(room, {
    type: "turn.cancelled",
    turnId: room.currentTurn?.turnId,
    speakerId: participant.id,
  });
  room.currentTurn = null;
}

export function attachRoomWebSocket(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url === "/room-ws") {
      roomWss.handleUpgrade(req, socket, head, (ws) => {
        roomWss.emit("connection", ws, req);
      });
    }
  });
  logger.info("Room WebSocket upgrade handler attached for /room-ws");
}
