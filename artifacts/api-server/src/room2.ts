import { WebSocket } from "ws";
import { logger } from "./lib/logger";

export type Lang = "id" | "en" | "bn";

export interface Participant2 {
  id: string;
  name: string;
  role: "trainer" | "participant";
  spokenLang: Lang;
  hearLang: Lang;
  ws: WebSocket;
  active: boolean;
  joinedAt: number;
}

export interface Turn2 {
  turnId: number;
  speakerId: string;
  speakerName: string;
  sourceLang: Lang;
  targets: Array<{
    lang: Lang;
    text: string;
    audioChunks: string[];
    firstByteAt: number | null;
    firstByteLatency: number | null;
  }>;
  sourceText: string;
  startedAt: number;
  completedAt: number | null;
  totalGap: number | null;
}

export interface Room2 {
  code: string;
  participants: Map<string, Participant2>;
  createdAt: number;
  currentSpeaker: string | null;
  turnId: number;
  audioBuffer: Buffer[];
  isListening: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  turns: Turn2[];
  currentTurn: Turn2 | null;
}

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "TR";
  for (let i = 0; i < 2; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Determine which languages each participant needs to hear
// Exclude the speaker's own language
export function getTargetLangsForParticipant(
  participant: Participant2,
  sourceLang: Lang,
  allParticipants: Participant2[],
): Lang[] {
  const targets: Lang[] = [];
  // If this is the speaker, they don't need to hear anything
  if (participant.spokenLang === sourceLang) {
    return targets;
  }
  // Everyone else hears in their hearLang
  targets.push(participant.hearLang);
  return targets;
}

// Get all unique target languages needed for a given source
export function getAllTargetLangs(sourceLang: Lang, allParticipants: Participant2[]): Lang[] {
  const langs = new Set<Lang>();
  for (const p of allParticipants) {
    if (p.spokenLang !== sourceLang) {
      langs.add(p.hearLang);
    }
  }
  return Array.from(langs);
}

const rooms2: Map<string, Room2> = new Map();

export function createRoom2(): string {
  let code = generateCode();
  while (rooms2.has(code)) {
    code = generateCode();
  }
  const room: Room2 = {
    code,
    participants: new Map(),
    createdAt: Date.now(),
    currentSpeaker: null,
    turnId: 0,
    audioBuffer: [],
    isListening: false,
    isProcessing: false,
    isPlaying: false,
    turns: [],
    currentTurn: null,
  };
  rooms2.set(code, room);
  logger.info({ code }, "Room2 created");
  return code;
}

export function getRoom2(code: string): Room2 | undefined {
  return rooms2.get(code);
}

export function joinRoom2(
  room: Room2,
  id: string,
  name: string,
  role: "trainer" | "participant",
  spokenLang: Lang,
  hearLang: Lang,
  ws: WebSocket,
): Participant2 {
  const participant: Participant2 = {
    id,
    name,
    role,
    spokenLang,
    hearLang,
    ws,
    active: true,
    joinedAt: Date.now(),
  };
  room.participants.set(id, participant);
  logger.info({ roomCode: room.code, participantId: id, name, role, spokenLang, hearLang }, "Participant2 joined");
  return participant;
}

export function leaveRoom2(room: Room2, participantId: string): void {
  const p = room.participants.get(participantId);
  if (p) {
    p.active = false;
    room.participants.delete(participantId);
    logger.info({ roomCode: room.code, participantId }, "Participant2 left");
    if (room.currentSpeaker === participantId) {
      room.currentSpeaker = null;
      room.isListening = false;
    }
  }
}

export function broadcastToRoom2(room: Room2, message: object, excludeId?: string): void {
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

export function sendToParticipant2(p: Participant2, message: object): void {
  if (p.ws.readyState === WebSocket.OPEN) {
    try {
      p.ws.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }
}

export function getParticipantList2(room: Room2): Array<{
  id: string;
  name: string;
  role: string;
  spokenLang: string;
  hearLang: string;
  active: boolean;
}> {
  return Array.from(room.participants.values()).map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    spokenLang: p.spokenLang,
    hearLang: p.hearLang,
    active: p.active,
  }));
}

export function cleanupRoom2(room: Room2): void {
  rooms2.delete(room.code);
  logger.info({ roomCode: room.code }, "Room2 cleaned up");
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms2) {
    if (room.participants.size === 0 && now - room.createdAt > 10 * 60 * 1000) {
      cleanupRoom2(room);
    }
  }
}, 60 * 1000);

export { rooms2 };
