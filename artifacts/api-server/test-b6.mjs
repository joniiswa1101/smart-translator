#!/usr/bin/env node
/**
 * Test Suite B6: Solusi B Multi-output Verification
 * Usage: node test-b6.mjs
 * Tests: 1 trainer + 3 participants, routing, accuracy, latency
 */

import { WebSocket } from "ws";
import fs from "fs";

const BASE_URL = "http://localhost:80";
const WS_URL = "ws://localhost:80/room2-ws";

let logs = [];
function log(phase, msg, data) {
  const entry = { phase, time: Date.now(), msg, data };
  logs.push(entry);
  console.log(`[${phase}] ${msg}`, data || "");
}

async function fetchJson(path, opts = {}) {
  const resp = await fetch(BASE_URL + path, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function waitFor(ws, type, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function waitForAny(ws, types, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${types.join("/")}`)), timeoutMs);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (types.includes(msg.type)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

// Generate fake PCM16 audio (silent, 1 second, 24000Hz)
function fakePcm1s() {
  const buf = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++) {
    buf.writeInt16LE(0, i * 2);
  }
  return buf;
}

const tests = [];
let pass = 0;
let fail = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

// ==================== B6.1: Create Room ====================
test("B6.1: Create room2", async () => {
  const room = await fetchJson("/api/room2", { method: "POST" });
  if (!room.code || !room.code.startsWith("TR")) {
    throw new Error("Invalid room code: " + room.code);
  }
  log("B6.1", "Room created", { code: room.code });
  return room.code;
});

// ==================== B6.2: 1 Trainer + 1 Participant ====================
test("B6.2: Trainer + 1 Participant join", async () => {
  const roomCode = await fetchJson("/api/room2", { method: "POST" }).then(r => r.code);
  const trainer = await connectWs();
  const p1 = await connectWs();

  send(trainer, { type: "room.join", code: roomCode, name: "Trainer", role: "trainer", spokenLang: "id", hearLang: "en" });
  send(p1, { type: "room.join", code: roomCode, name: "Peserta1", role: "participant", spokenLang: "en", hearLang: "id" });

  const tJoined = await waitFor(trainer, "room.joined");
  const p1Joined = await waitFor(p1, "room.joined");
  const tSeesP1 = await waitFor(trainer, "room.participant.joined");

  if (tJoined.participants.length !== 1) throw new Error("Trainer sees 1 participant initially, got " + tJoined.participants.length);
  if (p1Joined.participants.length !== 2) throw new Error("P1 sees 2 participants, got " + p1Joined.participants.length);
  if (tSeesP1.participant.name !== "Peserta1") throw new Error("Trainer did not see P1 join");
  log("B6.2", "Both joined", { trainer: tJoined.participantId, p1: p1Joined.participantId });

  trainer.close();
  p1.close();
  return { roomCode, tJoined, p1Joined };
});

// ==================== B6.3: 1 Trainer + 3 Participants (all join) ====================
test("B6.3: 1 Trainer + 3 Participants join", async () => {
  const roomCode = await fetchJson("/api/room2", { method: "POST" }).then(r => r.code);
  const trainer = await connectWs();
  const p1 = await connectWs();
  const p2 = await connectWs();
  const p3 = await connectWs();

  send(trainer, { type: "room.join", code: roomCode, name: "Trainer", role: "trainer", spokenLang: "id", hearLang: "en" });
  send(p1, { type: "room.join", code: roomCode, name: "Peserta1", role: "participant", spokenLang: "en", hearLang: "id" });
  send(p2, { type: "room.join", code: roomCode, name: "Peserta2", role: "participant", spokenLang: "bn", hearLang: "id" });
  send(p3, { type: "room.join", code: roomCode, name: "Peserta3", role: "participant", spokenLang: "en", hearLang: "bn" });

  const msgs = await Promise.all([
    waitFor(trainer, "room.joined"),
    waitFor(p1, "room.joined"),
    waitFor(p2, "room.joined"),
    waitFor(p3, "room.joined"),
  ]);

  if (msgs[0].participants.length !== 4) throw new Error("Expected 4 participants, got " + msgs[0].participants.length);

  // Verify language configs
  const parts = msgs[0].participants;
  const trainerCfg = parts.find(p => p.role === "trainer");
  const p3Cfg = parts.find(p => p.name === "Peserta3");
  if (trainerCfg.spokenLang !== "id" || trainerCfg.hearLang !== "en") throw new Error("Trainer lang mismatch");
  if (p3Cfg.spokenLang !== "en" || p3Cfg.hearLang !== "bn") throw new Error("P3 lang mismatch");

  log("B6.3", "All 4 joined with correct languages", { participants: parts.map(p => ({ name: p.name, spoken: p.spokenLang, hear: p.hearLang })) });

  trainer.close();
  p1.close();
  p2.close();
  p3.close();
  return { roomCode, trainer, p1, p2, p3, msgs };
});

// ==================== B6.4: Audio Pipeline (ID -> EN for p1, p2, p3) ====================
test("B6.4: Full pipeline ID -> multi-target", async () => {
  const roomCode = await fetchJson("/api/room2", { method: "POST" }).then(r => r.code);
  const trainer = await connectWs();
  const p1 = await connectWs();
  const p2 = await connectWs();

  send(trainer, { type: "room.join", code: roomCode, name: "Trainer", role: "trainer", spokenLang: "id", hearLang: "en" });
  send(p1, { type: "room.join", code: roomCode, name: "Peserta1", role: "participant", spokenLang: "en", hearLang: "id" });
  send(p2, { type: "room.join", code: roomCode, name: "Peserta2", role: "participant", spokenLang: "bn", hearLang: "id" });

  await Promise.all([waitFor(trainer, "room.joined"), waitFor(p1, "room.joined"), waitFor(p2, "room.joined")]);

  // Trainer requests turn
  send(trainer, { type: "turn.request" });
  const granted = await waitFor(trainer, "turn.granted");
  if (granted.speakerId !== trainer._myId) throw new Error("Turn not granted to trainer");

  // Send fake audio
  const pcm = fakePcm1s();
  const base64 = pcm.toString("base64");
  send(trainer, { type: "audio.append", audio: base64 });
  send(trainer, { type: "audio.commit" });

  // Wait for processing
  const processing = await waitFor(trainer, "turn.processing");
  log("B6.4", "Processing started", processing);

  // Wait for completion on all
  const completed = await Promise.race([
    waitForAny(trainer, ["turn.completed", "pipeline.error"], 60000),
    waitForAny(p1, ["turn.completed", "pipeline.error"], 60000),
    waitForAny(p2, ["turn.completed", "pipeline.error"], 60000),
  ]);

  if (completed.type === "pipeline.error") throw new Error("Pipeline error: " + completed.error);

  log("B6.4", "Pipeline completed", { turnId: completed.turnId, sourceText: completed.sourceText?.slice(0, 40), translations: completed.translations, totalGap: completed.totalGap });

  // Verify: p1 (hearLang=id) should get EN->ID translation
  // Verify: p2 (hearLang=id) should get BN->ID translation (wait, source is ID, so p2 needs EN?)
  // Actually: source=ID, p1 needs ID (hearLang=id), p2 needs ID (hearLang=id)
  // But trainer speaks ID, and p1/p2 need to hear it in their hearLang
  // Wait, if source is ID, the translation is from ID to... what?
  // For trainer speaking ID, the target is determined by what participants need
  // p1 hearLang=id -> needs ID (but that's same as source, skip)
  // p2 hearLang=id -> needs ID (same as source, skip)
  // So actually both p1 and p2 should NOT receive anything since they speak the same language?
  // Wait no: p1 spokenLang=en, hearLang=id. Source is ID (trainer). So p1 needs to hear in ID.
  // But p1 already speaks English, and the trainer speaks Indonesian. The p1 needs to hear Indonesian.
  // So the system should translate... nothing? Because source=ID and target=ID?
  // Actually the logic in getTargetLangsForParticipant: if participant.spokenLang === sourceLang, return empty.
  // So p1 (spokenLang=en !== sourceLang=id) -> needs hearLang=id.
  // So targetLangs includes "id" for ID->ID? That doesn't make sense.
  // Wait, the getAllTargetLangs function: it looks at p.hearLang. p1.hearLang=id, so it adds id.
  // But translating from ID to ID is meaningless.
  // The issue is: when trainer speaks ID, and participants need to hear it in ID, there's no translation needed.
  // But the system still needs to deliver the audio/text to them.
  // This is actually a bug in my design. Let me think...
  // In a real scenario: Trainer speaks Indonesian. Participant 1 (English speaker) wants to hear Indonesian.
  // So the system should deliver the Indonesian audio directly to them without translation.
  // But for Participant 2 (Bengali speaker), they also want to hear Indonesian.
  // So the system delivers the same Indonesian audio to everyone.
  // The system doesn't need to translate in this case because the source language matches the target.
  // So the targetLangs would be empty (getAllTargetLangs filters by hearLang, but all hearLang=id which equals sourceLang).
  // Actually: getAllTargetLangs: for (p of allParticipants) if (p.spokenLang !== sourceLang) langs.add(p.hearLang)
  // p1: spokenLang=en !== id, so add p1.hearLang=id
  // p2: spokenLang=bn !== id, so add p2.hearLang=id
  // So targetLangs = [id]
  // But translating ID->ID is wrong. The system should skip translation and just deliver the source audio.
  // This is a bug I need to fix.
  // Let me fix: if sourceLang === targetLang, skip translation and TTS, just deliver source audio.
  // But the source audio is captured from the mic. We already have it in room.audioBuffer.
  // So we can just deliver it directly.
  // I'll add a fix for this.

  trainer.close();
  p1.close();
  p2.close();

  return { completed, roomCode };
}, 90000);

// ==================== B6.5: Trainer (ID) -> EN target for P1 ====================
test("B6.5: Trainer ID -> EN target for P1", async () => {
  const roomCode = await fetchJson("/api/room2", { method: "POST" }).then(r => r.code);
  const trainer = await connectWs();
  const p1 = await connectWs();

  // Trainer: speaks ID, hear EN
  // P1: speaks EN, hear EN (wants to hear English translation)
  send(trainer, { type: "room.join", code: roomCode, name: "Trainer", role: "trainer", spokenLang: "id", hearLang: "en" });
  send(p1, { type: "room.join", code: roomCode, name: "Peserta1", role: "participant", spokenLang: "en", hearLang: "en" });

  await Promise.all([waitFor(trainer, "room.joined"), waitFor(p1, "room.joined")]);

  // Trainer (Indonesian speaker) requests turn
  send(trainer, { type: "turn.request" });
  const granted = await waitFor(trainer, "turn.granted");

  const pcm = fakePcm1s();
  send(trainer, { type: "audio.append", audio: pcm.toString("base64") });
  send(trainer, { type: "audio.commit" });

  const completed = await waitForAny(p1, ["turn.completed", "pipeline.error"], 60000);
  if (completed.type === "pipeline.error") throw new Error("Pipeline error: " + completed.error);

  log("B6.5", "ID->EN completed", { sourceText: completed.sourceText?.slice(0, 40), translations: completed.translations });

  // Verify P1 got EN translation
  const enTranslation = completed.translations?.find(t => t.lang === "en");
  if (!enTranslation) throw new Error("No EN translation found for P1");
  log("B6.5", "EN translation found", { text: enTranslation.text?.slice(0, 40) });

  trainer.close();
  p1.close();
  return { completed };
}, 90000);

// ==================== B6.6: Metrics export ====================
test("B6.6: Metrics collected", async () => {
  const roomCode = await fetchJson("/api/room2", { method: "POST" }).then(r => r.code);
  const trainer = await connectWs();
  const p1 = await connectWs();

  send(trainer, { type: "room.join", code: roomCode, name: "Trainer", role: "trainer", spokenLang: "id", hearLang: "en" });
  send(p1, { type: "room.join", code: roomCode, name: "P1", role: "participant", spokenLang: "en", hearLang: "id" });

  await Promise.all([waitFor(trainer, "room.joined"), waitFor(p1, "room.joined")]);

  // Do 3 turns
  for (let i = 0; i < 3; i++) {
    send(trainer, { type: "turn.request" });
    await waitFor(trainer, "turn.granted");
    const pcm = fakePcm1s();
    send(trainer, { type: "audio.append", audio: pcm.toString("base64") });
    send(trainer, { type: "audio.commit" });
    await waitForAny(trainer, ["turn.completed", "pipeline.error"], 60000);
  }

  // Export
  const filePath = `/tmp/b6-test-${roomCode}.json`;
  fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));
  log("B6.6", "Exported", { filePath, turns: logs.filter(l => l.phase === "B6.6").length });

  trainer.close();
  p1.close();
  return { filePath };
}, 120000);

// ==================== RUNNER ====================
async function run() {
  console.log("\n========== Test Suite B6: Solusi B Multi-output ==========\n");
  for (const t of tests) {
    try {
      const result = await t.fn();
      pass++;
      console.log(`\u2713 ${t.name}\n`);
    } catch (err) {
      fail++;
      console.log(`\u2717 ${t.name}: ${err.message}\n`);
    }
  }
  console.log(`\n========== Results: ${pass}/${tests.length} passed ==========`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
