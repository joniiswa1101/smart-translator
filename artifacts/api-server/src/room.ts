import { WebSocket } from "ws";
import { logger } from "./lib/logger";

export type Lang = "id" | "en" | "bn";

export interface Participant {
  id: string;
  name: string;
  role: "trainer" | "participant";
  lang: Lang;
  ws: WebSocket;
  active: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;
  participants: Map<string, Participant>;
  createdAt: number;
  openaiWs: WebSocket | null;
  currentSpeaker: string | null;
  turnId: number;
  audioBuffer: Buffer[];
  isListening: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  turns: Turn[];
  currentTurn: Turn | null;
  openaiConfig: {
    model: string;
    instructions: string;
  };
  trainerMode: boolean;
}

export interface Turn {
  turnId: number;
  speakerId: string;
  speakerName: string;
  sourceLang: Lang;
  targetLang: Lang;
  sourceText: string;
  translationText: string;
  firstByteLatency: number | null;
  totalGap: number | null;
  startedAt: number;
  firstByteAt: number | null;
  completedAt: number | null;
}

// Generate 4-character room code (e.g., "TR42")
function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "TR";
  for (let i = 0; i < 2; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Map source language to target language (routing)
// Trainer (ID) -> EN (participants)
// Participants (EN) -> ID (trainer)
// Participants (BN) -> ID (trainer)
export function getTargetLang(sourceLang: Lang, roomParticipants: Participant[]): Lang {
  // If trainer is speaking (ID), target is EN for all participants
  if (sourceLang === "id") return "en";
  // If English or Bengali speaker, target is ID (trainer's language)
  return "id";
}

export function getInstructions(sourceLang: Lang, targetLang: Lang): string {
  const pairs: Record<string, string> = {
    "id-en": "Translate the speaker's Indonesian into natural English. Do not add commentary, do not say \"here is the translation\" or \"okay\" - just say the translated sentence itself.",
    "en-id": "Translate the speaker's English into natural Indonesian. Do not add commentary, do not say \"here is the translation\" or \"okay\" - just say the translated sentence itself.",
    "bn-id": "Translate the speaker's Bengali into natural Indonesian. Do not add commentary, do not say \"here is the translation\" or \"okay\" - just say the translated sentence itself.",
  };
  return pairs[`${sourceLang}-${targetLang}`] || pairs["id-en"];
}

// Room storage
const rooms: Map<string, Room> = new Map();

export function createRoom(): string {
  let code = generateCode();
  while (rooms.has(code)) {
    code = generateCode();
  }
  const room: Room = {
    code,
    participants: new Map(),
    createdAt: Date.now(),
    openaiWs: null,
    currentSpeaker: null,
    turnId: 0,
    audioBuffer: [],
    isListening: false,
    isProcessing: false,
    isPlaying: false,
    turns: [],
    currentTurn: null,
    openaiConfig: {
      model: "gpt-realtime",
      instructions: getInstructions("id", "en"),
    },
    trainerMode: false,
  };
  rooms.set(code, room);
  logger.info({ code }, "Room created");
  return code;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function joinRoom(
  room: Room,
  id: string,
  name: string,
  role: "trainer" | "participant",
  lang: Lang,
  ws: WebSocket,
): Participant {
  const participant: Participant = {
    id,
    name,
    role,
    lang,
    ws,
    active: true,
    joinedAt: Date.now(),
  };
  room.participants.set(id, participant);
  logger.info({ roomCode: room.code, participantId: id }, "Participant joined");
  return participant;
}

export function leaveRoom(room: Room, participantId: string): void {
  const p = room.participants.get(participantId);
  if (p) {
    p.active = false;
    room.participants.delete(participantId);
    logger.info({ roomCode: room.code, participantId }, "Participant left");
    // If the speaker left, clear the lock
    if (room.currentSpeaker === participantId) {
      room.currentSpeaker = null;
      room.isListening = false;
    }
  }
}

export function broadcastToRoom(room: Room, message: object, excludeId?: string): void {
  const text = JSON.stringify(message);
  for (const [id, p] of room.participants) {
    if (excludeId && id === excludeId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      try {
        p.ws.send(text);
      } catch {
        // ignore
      }
    }
  }
}

export function sendToParticipant(p: Participant, message: object): void {
  if (p.ws.readyState === WebSocket.OPEN) {
    try {
      p.ws.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }
}

export function getParticipantList(room: Room): Array<{
  id: string;
  name: string;
  role: string;
  lang: string;
  active: boolean;
}> {
  return Array.from(room.participants.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    lang: p.lang,
    active: p.active,
  }));
}

export function cleanupRoom(room: Room): void {
  if (room.openaiWs) {
    try {
      room.openaiWs.close();
    } catch {
      // ignore
    }
    room.openaiWs = null;
  }
  rooms.delete(room.code);
  logger.info({ roomCode: room.code }, "Room cleaned up");
}

// Auto-cleanup old rooms (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Delete room if empty and >10 min old
    if (room.participants.size === 0 && now - room.createdAt > 10 * 60 * 1000) {
      cleanupRoom(room);
    }
  }
}, 60 * 1000);

export { rooms };
