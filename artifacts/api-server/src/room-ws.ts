import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
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

export function attachRoomWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/room-ws" });

  wss.on("connection", (ws: WebSocket) => {
    let participantId: string | null = null;
    let roomCode: string | null = null;
    let room: Room | null = null;
    let participant: Participant | null = null;

    logger.info("New client connected to room WebSocket");

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
        const { code, name, role, lang } = msg;
        const targetRoom = getRoom(code);
        if (!targetRoom) {
          ws.send(JSON.stringify({ type: "room.error", error: "Room not found" }));
          return;
        }
        roomCode = code;
        room = targetRoom;
        participantId = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        participant = joinRoom(room, participantId, name, role, lang as Lang, ws);

        // Send confirmation
        ws.send(JSON.stringify({
          type: "room.joined",
          participantId,
          code: room.code,
          role,
          lang,
          participants: getParticipantList(room),
        }));

        // Broadcast to others
        broadcastToRoom(room, {
          type: "room.participant.joined",
          participant: { id: participantId, name, role, lang, active: true },
        }, participantId);

        // Connect to OpenAI if not already connected
        ensureOpenAIConnection(room);
        return;
      }

      if (!room || !participant || !participantId) {
        ws.send(JSON.stringify({ type: "room.error", error: "Not joined to a room" }));
        return;
      }

      if (type === "audio.append") {
        // Audio fragments from client
        if (!room.isListening || room.currentSpeaker !== participantId) {
          // Ignore audio if not the current speaker
          return;
        }
        if (msg.audio && typeof msg.audio === "string") {
          const buf = Buffer.from(msg.audio, "base64");
          room.audioBuffer.push(buf);
        }
        return;
      }

      if (type === "audio.commit") {
        // Client finished a turn
        if (!room.isListening || room.currentSpeaker !== participantId) {
          return;
        }

        // Commit to OpenAI
        commitAudioTurn(room, participant);
        return;
      }

      if (type === "turn.request") {
        // Client wants to speak
        if (room.isListening || room.isProcessing || room.isPlaying) {
          // Someone else is speaking or processing
          ws.send(JSON.stringify({ type: "turn.rejected", reason: "Busy" }));
          return;
        }

        // Grant turn
        room.currentSpeaker = participantId;
        room.isListening = true;
        room.audioBuffer = [];
        room.turnId += 1;
        const targetLang = getTargetLang(participant.lang, Array.from(room.participants.values()));
        room.openaiConfig.instructions = getInstructions(participant.lang, targetLang);

        // Create turn record
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

        // Update OpenAI session
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

        // Broadcast to everyone
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
        // Client cancels their turn
        if (room.currentSpeaker === participantId) {
          cancelTurn(room, participant);
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

  logger.info("Room WebSocket attached at /room-ws");
}

function ensureOpenAIConnection(room: Room) {
  if (room.openaiWs && room.openaiWs.readyState === WebSocket.OPEN) {
    return;
  }

  const ws = new WebSocket(OPENAI_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  ws.on("open", () => {
    logger.info({ roomCode: room.code }, "OpenAI Realtime connected for room");
    // Initialize session
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
    // Audio chunk from OpenAI
    if (room.isProcessing && room.currentTurn) {
      // Track first byte
      if (!room.currentTurn.firstByteAt) {
        room.currentTurn.firstByteAt = Date.now();
        room.currentTurn.firstByteLatency = room.currentTurn.firstByteAt - room.currentTurn.startedAt;
      }

      // Broadcast audio to all clients
      broadcastToRoom(room, {
        type: "response.audio.delta",
        turnId: room.currentTurn.turnId,
        audio: msg.audio,
      });

      // If transitioning from processing to playing
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
    // Audio done
    if (room.currentTurn) {
      broadcastToRoom(room, {
        type: "response.audio.done",
        turnId: room.currentTurn.turnId,
      });
    }
    return;
  }

  if (msg.type === "conversation.item.input_audio_transcription.completed") {
    // Source transcription
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
    // Translation transcript
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
    // Turn completed
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

      // Reset turn
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

  // Merge all audio buffers
  const totalLen = room.audioBuffer.reduce((acc, b) => acc + b.length, 0);
  const merged = Buffer.concat(room.audioBuffer, totalLen);

  if (merged.length === 0) {
    return;
  }

  // Send to OpenAI
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

  room.openaiWs.send(JSON.stringify({
    type: "input_audio_buffer.commit",
  }));

  // Wait for committed then create response
  room.openaiWs.send(JSON.stringify({
    type: "response.create",
  }));

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
