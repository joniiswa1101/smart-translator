import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { logger } from "./lib/logger";
import { buildGlossaryContext } from "./glossary";
import {
  getRoom2,
  joinRoom2,
  leaveRoom2,
  broadcastToRoom2,
  sendToParticipant2,
  getParticipantList2,
  cleanupRoom2,
  getAllTargetLangs,
  getTargetLangsForParticipant,
  type Room2,
  type Participant2,
  type Turn2,
  type Lang,
} from "./room2";

const API_KEY = process.env["OPENAI_API_KEY"];

interface WsMessage {
  type: string;
  [key: string]: any;
}

export const room2Wss = new WebSocketServer({ noServer: true });

export function attachRoom2WebSocket(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url === "/room2-ws") {
      room2Wss.handleUpgrade(req, socket, head, (ws) => {
        room2Wss.emit("connection", ws, req);
      });
    }
  });
}

room2Wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  logger.info({ url: req.url }, "New client connected to room2 WebSocket");

  let participantId: string | null = null;
  let roomCode: string | null = null;
  let room: Room2 | null = null;
  let participant: Participant2 | null = null;

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
      const { code, name, role, spokenLang, hearLang, trainerMode } = msg;
      const targetRoom = getRoom2(code);
      if (!targetRoom) {
        ws.send(JSON.stringify({ type: "room.error", error: "Room not found" }));
        return;
      }
      roomCode = code;
      room = targetRoom;
      participantId = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      participant = joinRoom2(room, participantId, name, role, spokenLang as Lang, hearLang as Lang, ws);
      if (role === "trainer" && trainerMode === true) {
        room.trainerMode = true;
      }

      ws.send(JSON.stringify({
        type: "room.joined",
        participantId,
        code: room.code,
        role,
        spokenLang,
        hearLang,
        trainerMode: room.trainerMode,
        participants: getParticipantList2(room),
      }));

      broadcastToRoom2(room, {
        type: "room.participant.joined",
        participant: { id: participantId, name, role, spokenLang, hearLang, active: true },
      }, participantId);
      return;
    }

    if (!room || !participant || !participantId) {
      ws.send(JSON.stringify({ type: "room.error", error: "Not joined to a room" }));
      return;
    }

    if (type === "audio.append") {
      if (!room.isListening || room.currentSpeaker !== participantId) {
        logger.debug({ participantId, isListening: room.isListening, currentSpeaker: room.currentSpeaker }, "audio.append rejected");
        return;
      }
      if (msg.audio && typeof msg.audio === "string") {
        room.audioBuffer.push(Buffer.from(msg.audio, "base64"));
      }
      return;
    }

    if (type === "audio.commit") {
      if (!room.isListening || room.currentSpeaker !== participantId) {
        logger.debug({ participantId, isListening: room.isListening, currentSpeaker: room.currentSpeaker }, "audio.commit rejected");
        return;
      }
      commitAudioTurn2(room, participant);
      return;
    }

    if (type === "turn.request") {
      logger.info({ participantId, name: participant.name, role: participant.role, currentSpeaker: room.currentSpeaker, isListening: room.isListening, isProcessing: room.isProcessing }, "Turn request received");
      if (participant.role === "trainer" && room.trainerMode && (room.isListening || room.isProcessing || room.isPlaying)) {
        if (room.currentSpeaker && room.currentSpeaker !== participantId) {
          const current = room.participants.get(room.currentSpeaker);
          if (current) {
            cancelTurn2(room, current);
          }
        }
      }
      if (room.isListening || room.isProcessing || room.isPlaying) {
        ws.send(JSON.stringify({ type: "turn.rejected", reason: "Busy" }));
        logger.info({ participantId, name: participant.name, reason: "Busy" }, "Turn rejected");
        return;
      }
      room.currentSpeaker = participantId;
      room.isListening = true;
      room.audioBuffer = [];
      room.turnId += 1;

      const turn: Turn2 = {
        turnId: room.turnId,
        speakerId: participantId,
        speakerName: participant.name,
        sourceLang: participant.spokenLang,
        targets: [],
        sourceText: "",
        startedAt: Date.now(),
        completedAt: null,
        totalGap: null,
      };
      room.currentTurn = turn;
      room.turns.push(turn);

      broadcastToRoom2(room, {
        type: "turn.granted",
        turnId: room.turnId,
        speakerId: participantId,
        speakerName: participant.name,
        sourceLang: participant.spokenLang,
      });
      return;
    }

    if (type === "turn.cancel") {
      if (room.currentSpeaker === participantId) {
        cancelTurn2(room, participant);
      }
      return;
    }

    if (type === "room.trainerMode") {
      if (participant.role === "trainer") {
        room.trainerMode = msg.enabled === true;
        broadcastToRoom2(room, { type: "room.trainerMode", enabled: room.trainerMode });
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
        cancelTurn2(room, participant!);
      }
      leaveRoom2(room, participantId);
      broadcastToRoom2(room, {
        type: "room.participant.left",
        participantId,
      }, participantId);
      if (room.participants.size === 0) {
        cleanupRoom2(room);
      }
    }
    logger.info({ participantId, roomCode }, "Client disconnected from room2");
  });

  ws.on("error", (err) => {
    logger.error({ err, participantId, roomCode }, "Room2 WebSocket error");
  });
});

async function commitAudioTurn2(room: Room2, participant: Participant2) {
  const totalLen = room.audioBuffer.reduce((acc, b) => acc + b.length, 0);
  const merged = Buffer.concat(room.audioBuffer, totalLen);

  if (merged.length === 0) {
    cancelTurn2(room, participant);
    return;
  }

  room.isListening = false;
  room.isProcessing = true;

  const turn = room.currentTurn!;
  const isStale = () => room.currentTurn !== turn;

  broadcastToRoom2(room, {
    type: "turn.processing",
    turnId: turn.turnId,
    speakerId: participant.id,
  });

  const allParticipants = Array.from(room.participants.values());

  try {
    // STEP 1: ASR
    const asrStart = Date.now();
    const sourceText = await transcribeAudio(merged, participant.spokenLang);
    if (isStale()) return;
    turn.sourceText = sourceText;
    logger.info({ roomCode: room.code, turnId: turn.turnId, asrMs: Date.now() - asrStart, sourceText: sourceText.slice(0, 100) }, "ASR completed");

    broadcastToRoom2(room, {
      type: "turn.source.transcription",
      turnId: turn.turnId,
      sourceText,
    });

    // STEP 2: Determine target languages
    const targetLangs = getAllTargetLangs(allParticipants, turn.speakerId).filter(
      (lang) => lang !== turn.sourceLang,
    );
    logger.info({ roomCode: room.code, turnId: turn.turnId, targetLangs }, "Target languages");

    // STEP 3: Translate
    const translateStart = Date.now();
    const translations = await Promise.all(
      targetLangs.map(async (lang) => {
        const text = await translateText(sourceText, turn.sourceLang, lang);
        return { lang, text };
      }),
    );
    if (isStale()) return;
    logger.info({ roomCode: room.code, turnId: turn.turnId, translateMs: Date.now() - translateStart }, "Translation completed");

    // STEP 4: TTS + immediate fan-out
    const ttsStart = Date.now();
    const ttsResults = await Promise.all(
      translations.map(async ({ lang, text }) => {
        const audioChunks: string[] = [];
        const result = await ttsGenerate(
          text,
          lang,
          (chunk) => {
            audioChunks.push(chunk);
            for (const p of allParticipants) {
              const neededLangs = getTargetLangsForParticipant(p, turn.speakerId);
              if (neededLangs.includes(lang)) {
                sendToParticipant2(p, {
                  type: "response.audio.delta",
                  turnId: turn.turnId,
                  lang,
                  text,
                  audio: chunk,
                });
              }
            }
          },
          () => {},
        );
        return {
          lang,
          text,
          audioChunks: result.audioChunks,
          firstByteAt: result.firstByteAt,
          firstByteLatency: result.firstByteAt ? result.firstByteAt - turn.startedAt : null,
        };
      }),
    );
    if (isStale()) return;
    logger.info({ roomCode: room.code, turnId: turn.turnId, ttsMs: Date.now() - ttsStart }, "TTS completed");

    // STEP 5: source audio for same-language listeners
    const sourceAudioChunks: string[] = [];
    let sourceFirstByteAt: number | null = null;
    const chunkSize = 24000 * 2 * 0.1;
    for (let i = 0; i < merged.length; i += chunkSize) {
      const chunk = merged.subarray(i, i + chunkSize);
      const base64 = chunk.toString("base64");
      sourceAudioChunks.push(base64);
      if (!sourceFirstByteAt) sourceFirstByteAt = Date.now();
      for (const p of allParticipants) {
        const neededLangs = getTargetLangsForParticipant(p, turn.speakerId);
        if (neededLangs.includes(turn.sourceLang)) {
          sendToParticipant2(p, {
            type: "response.audio.delta",
            turnId: turn.turnId,
            lang: turn.sourceLang,
            text: turn.sourceText,
            audio: base64,
          });
        }
      }
    }

    if (sourceAudioChunks.length > 0) {
      ttsResults.push({
        lang: turn.sourceLang,
        text: turn.sourceText,
        audioChunks: sourceAudioChunks,
        firstByteAt: sourceFirstByteAt,
        firstByteLatency: sourceFirstByteAt ? sourceFirstByteAt - turn.startedAt : null,
      });
    }

    turn.targets = ttsResults;
    turn.completedAt = Date.now();
    turn.totalGap = turn.completedAt - turn.startedAt;

    // DIAGNOSTIC: log exactly what each participant receives
    logger.info(
      {
        roomCode: room.code,
        turnId: turn.turnId,
        speaker: `${turn.speakerName}(${turn.sourceLang})`,
        audioFanout: allParticipants.map((p) => {
          const needed = getTargetLangsForParticipant(p, turn.speakerId);
          const heard = turn.targets
            .filter((r) => needed.includes(r.lang))
            .map((r) => `${r.lang}:"${r.text}"`);
          return `${p.name}[${p.role},hear=${p.hearLang}] <= ${heard.join(" | ") || "(nothing)"}`;
        }),
      },
      "Audio fan-out summary",
    );

    // Fan-out completion
    for (const p of allParticipants) {
      const neededLangs = getTargetLangsForParticipant(p, turn.speakerId);
      const myTranslations = turn.targets
        .filter((r) => neededLangs.includes(r.lang))
        .map((r) => ({ lang: r.lang, text: r.text }));

      sendToParticipant2(p, {
        type: "turn.completed",
        turnId: turn.turnId,
        speakerId: turn.speakerId,
        speakerName: turn.speakerName,
        sourceLang: turn.sourceLang,
        sourceText: turn.sourceText,
        translations: myTranslations,
        totalGap: turn.totalGap,
      });
    }

    room.isProcessing = false;
    room.isPlaying = false;
    room.currentSpeaker = null;
    room.currentTurn = null;
    room.audioBuffer = [];

  } catch (err: any) {
    if (isStale()) return;
    logger.error({ err: err.message, roomCode: room.code, turnId: turn.turnId }, "Pipeline error");
    broadcastToRoom2(room, {
      type: "pipeline.error",
      turnId: turn.turnId,
      error: err.message,
    });
    cancelTurn2(room, participant);
  }
}

function cancelTurn2(room: Room2, participant: Participant2) {
  if (room.currentSpeaker !== participant.id) return;
  room.currentSpeaker = null;
  room.isListening = false;
  room.isProcessing = false;
  room.isPlaying = false;
  room.audioBuffer = [];
  if (room.currentTurn) {
    room.currentTurn.completedAt = Date.now();
    room.currentTurn.totalGap = null;
  }
  broadcastToRoom2(room, {
    type: "turn.cancelled",
    turnId: room.currentTurn?.turnId,
    speakerId: participant.id,
  });
  room.currentTurn = null;
}

// ========== ASR ==========
async function transcribeAudio(pcmBuffer: Buffer, spokenLang: string): Promise<string> {
  const wav = pcm16ToWav(pcmBuffer, 24000);
  const form = new FormData();
  const blob = new Blob([new Uint8Array(wav)], { type: "audio/wav" });
  form.append("file", blob, "audio.wav");
  form.append("model", "gpt-4o-transcribe");
  form.append("language", spokenLang);
  const promptByLang: Record<string, string> = {
    bn: "Transcribe in Bengali script only. Do not use Chinese, English, or any other language.",
    id: "Transcribe in Indonesian. Use standard Indonesian spelling.",
    en: "Transcribe in English. Use standard English spelling.",
  };
  form.append("prompt", promptByLang[spokenLang] || promptByLang["en"]);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`ASR failed: ${resp.status} ${text}`);
  }
  const data: any = await resp.json();
  return data.text || "";
}

// ========== TRANSLATE ==========
async function translateText(text: string, sourceLang: Lang, targetLang: Lang): Promise<string> {
  const langNames = { id: "Indonesian", en: "English", bn: "Bengali" };
  const glossary = buildGlossaryContext(sourceLang, targetLang);
  const prompt = `Translate the following text from ${langNames[sourceLang]} to ${langNames[targetLang]}.

Rules:
- Return ONLY the translated sentence in ${langNames[targetLang]}.
- Do NOT transliterate. Write in natural ${langNames[targetLang]} script.
- Keep the same meaning, tone, and level of formality.
- Use the glossary terms exactly as given.

Text: ${text}${glossary}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Translate failed: ${resp.status} ${text}`);
  }
  const data: any = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ========== TTS ==========
async function ttsGenerate(
  text: string,
  lang: Lang,
  onChunk: (chunk: string) => void,
  onFirstByte: () => void,
): Promise<{ audioChunks: string[]; firstByteAt: number | null }> {
  const voiceMap: Record<Lang, string> = { id: "nova", en: "echo", bn: "alloy" };
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: voiceMap[lang],
      input: text,
      response_format: "pcm",
      instructions: `Speak in natural ${lang === "id" ? "Indonesian" : lang === "en" ? "English" : "Bengali"}. Use native pronunciation, correct accent, and natural intonation. This is a spoken translation for a language learning context.`,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`TTS failed: ${resp.status} ${txt}`);
  }

  const audioBuffer = Buffer.from(await resp.arrayBuffer());
  const firstByteAt = Date.now();
  onFirstByte();

  const chunkSize = 24000 * 2 * 0.1;
  const audioChunks: string[] = [];
  for (let i = 0; i < audioBuffer.length; i += chunkSize) {
    const chunk = audioBuffer.subarray(i, i + chunkSize);
    const base64 = chunk.toString("base64");
    audioChunks.push(base64);
    onChunk(base64);
  }

  return { audioChunks, firstByteAt };
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * 2;
  const dataSize = pcm.length;
  const headerSize = 44;
  const wav = Buffer.alloc(headerSize + dataSize);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) wav[offset + i] = str.charCodeAt(i);
  };

  writeString(0, "RIFF");
  wav.writeUInt32LE(36 + dataSize, 4);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(numChannels * 2, 32);
  wav.writeUInt16LE(16, 34);
  writeString(36, "data");
  wav.writeUInt32LE(dataSize, 40);
  pcm.copy(wav, 44);

  return wav;
}
