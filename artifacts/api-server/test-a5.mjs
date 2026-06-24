#!/usr/bin/env node
/**
 * Test suite A5: Verifikasi Multi-Input Single-Output
 * Menggunakan TTS untuk mensimulasikan audio, lalu mengukur latency dan akurasi.
 */
import WebSocket from "ws";

const API_KEY = process.env["OPENAI_API_KEY"];
const BASE_URL = "http://localhost:8080";
const WS_URL = "ws://localhost:8080/room-ws";

// Sample phrases for each language
const TEST_PHRASES = {
  id: [
    "Selamat sore, saya mau bertanya tentang jadwal training besok.",
    "Terima kasih banyak atas bantuannya hari ini.",
  ],
  en: [
    "Thank you very much for your help, I really appreciate it.",
    "Good afternoon everyone, let's start the session.",
  ],
  bn: [
    "ধন্যবাদ, আমি কালকের প্রশিক্ষণের সময়সূচি জানতে চাই।",
    "সুপ্রভাত, আমরা কি শুরু করতে পারি?",
  ],
};

const VOICE_MAP = {
  id: "alloy",
  en: "verse",
  bn: "alloy",
};

async function tts(text, voice) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "pcm",
    }),
  });
  if (!r.ok) throw new Error("TTS " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function createRoom() {
  const r = await fetch(`${BASE_URL}/api/room`, { method: "POST" });
  const data = await r.json();
  return data.code;
}

function connectRoom(code, name, role, lang) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = {
      ws,
      participantId: null,
      messages: [],
      turns: [],
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "room.join", code, name, role, lang }));
    });

    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString());
      state.messages.push(msg);
      if (msg.type === "room.joined") {
        state.participantId = msg.participantId;
        resolve(state);
      }
      if (msg.type === "turn.completed") {
        state.turns.push(msg);
      }
    });

    ws.on("error", reject);
    ws.on("close", () => {
      // ignore
    });
  });
}

function requestTurn(ws) {
  ws.send(JSON.stringify({ type: "turn.request" }));
}

function sendAudio(ws, pcmBuf) {
  const chunkSize = 8192;
  for (let i = 0; i < pcmBuf.length; i += chunkSize) {
    const chunk = pcmBuf.slice(i, i + chunkSize);
    ws.send(JSON.stringify({
      type: "audio.append",
      audio: chunk.toString("base64"),
    }));
  }
  ws.send(JSON.stringify({ type: "audio.commit" }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTurn(state, pcmBuf, expectedLang) {
  const start = Date.now();
  requestTurn(state.ws);

  // Wait for turn.granted
  let granted = false;
  while (!granted) {
    const msg = state.messages.find((m) => m.type === "turn.granted");
    if (msg) {
      granted = true;
      // Clear
      state.messages = state.messages.filter((m) => m.type !== "turn.granted");
    }
    await sleep(100);
  }

  await sleep(300);
  sendAudio(state.ws, pcmBuf);

  // Wait for turn.completed
  let completed = null;
  const deadline = Date.now() + 20000;
  while (!completed && Date.now() < deadline) {
    const msg = state.messages.find((m) => m.type === "turn.completed");
    if (msg) {
      completed = msg;
      state.messages = state.messages.filter((m) => m.type !== "turn.completed");
    }
    await sleep(100);
  }

  return completed;
}

async function runTest() {
  console.log("\n========== A5 TEST SUITE ==========\n");

  // Create room
  const code = await createRoom();
  console.log("Room created:", code);

  // Join trainer (ID)
  const trainer = await connectRoom(code, "Trainer", "trainer", "id");
  console.log("Trainer joined:", trainer.participantId);

  // Join 3 participants
  const p1 = await connectRoom(code, "Peserta1", "participant", "bn");
  const p2 = await connectRoom(code, "Peserta2", "participant", "en");
  const p3 = await connectRoom(code, "Peserta3", "participant", "en");
  console.log("Participants joined");

  await sleep(500);

  const results = {
    room: code,
    startedAt: new Date().toISOString(),
    tests: [],
  };

  // A5.2: Test ID → EN
  console.log("\n--- A5.2: ID → EN ---");
  for (const phrase of TEST_PHRASES.id) {
    const pcm = await tts(phrase, VOICE_MAP.id);
    const turn = await runTurn(trainer, pcm, "id");
    if (turn) {
      results.tests.push({
        test: "A5.2",
        direction: "id→en",
        source: phrase,
        sourceText: turn.sourceText,
        translation: turn.translationText,
        firstByteLatency: turn.firstByteLatency,
        totalGap: turn.totalGap,
        passed: !!turn.translationText,
      });
      console.log("  Source:", turn.sourceText?.slice(0, 60));
      console.log("  Trans:", turn.translationText?.slice(0, 60));
      console.log("  FirstByte:", turn.firstByteLatency, "ms");
      console.log("  TotalGap:", turn.totalGap, "ms");
    } else {
      console.log("  FAILED: no turn completed");
      results.tests.push({ test: "A5.2", direction: "id→en", source: phrase, passed: false });
    }
    await sleep(2000);
  }

  // A5.3: Test EN → ID
  console.log("\n--- A5.3: EN → ID ---");
  for (const phrase of TEST_PHRASES.en) {
    const pcm = await tts(phrase, VOICE_MAP.en);
    const turn = await runTurn(p2, pcm, "en");
    if (turn) {
      results.tests.push({
        test: "A5.3",
        direction: "en→id",
        source: phrase,
        sourceText: turn.sourceText,
        translation: turn.translationText,
        firstByteLatency: turn.firstByteLatency,
        totalGap: turn.totalGap,
        passed: !!turn.translationText,
      });
      console.log("  Source:", turn.sourceText?.slice(0, 60));
      console.log("  Trans:", turn.translationText?.slice(0, 60));
      console.log("  FirstByte:", turn.firstByteLatency, "ms");
      console.log("  TotalGap:", turn.totalGap, "ms");
    } else {
      console.log("  FAILED: no turn completed");
      results.tests.push({ test: "A5.3", direction: "en→id", source: phrase, passed: false });
    }
    await sleep(2000);
  }

  // A5.4: Test BN → ID
  console.log("\n--- A5.4: BN → ID ---");
  for (const phrase of TEST_PHRASES.bn) {
    const pcm = await tts(phrase, VOICE_MAP.bn);
    const turn = await runTurn(p1, pcm, "bn");
    if (turn) {
      results.tests.push({
        test: "A5.4",
        direction: "bn→id",
        source: phrase,
        sourceText: turn.sourceText,
        translation: turn.translationText,
        firstByteLatency: turn.firstByteLatency,
        totalGap: turn.totalGap,
        passed: !!turn.translationText,
      });
      console.log("  Source:", turn.sourceText?.slice(0, 60));
      console.log("  Trans:", turn.translationText?.slice(0, 60));
      console.log("  FirstByte:", turn.firstByteLatency, "ms");
      console.log("  TotalGap:", turn.totalGap, "ms");
    } else {
      console.log("  FAILED: no turn completed");
      results.tests.push({ test: "A5.4", direction: "bn→id", source: phrase, passed: false });
    }
    await sleep(2000);
  }

  // A5.5: Test 2 speakers back-to-back
  console.log("\n--- A5.5: Back-to-back speakers ---");
  const pcm1 = await tts(TEST_PHRASES.id[0], VOICE_MAP.id);
  const pcm2 = await tts(TEST_PHRASES.en[0], VOICE_MAP.en);

  // Trainer speaks
  requestTurn(trainer.ws);
  await sleep(500);
  sendAudio(trainer.ws, pcm1);

  // Immediately try participant speaks (should be rejected)
  await sleep(500);
  requestTurn(p2.ws);

  // Wait for both
  let trainerDone = false;
  let participantRejection = false;
  const deadline = Date.now() + 20000;
  while ((!trainerDone || !participantRejection) && Date.now() < deadline) {
    const tDone = trainer.messages.find((m) => m.type === "turn.completed");
    const pRej = p2.messages.find((m) => m.type === "turn.rejected");
    if (tDone) {
      trainerDone = true;
      trainer.messages = trainer.messages.filter((m) => m.type !== "turn.completed");
    }
    if (pRej) {
      participantRejection = true;
      p2.messages = p2.messages.filter((m) => m.type !== "turn.rejected");
    }
    await sleep(100);
  }

  results.tests.push({
    test: "A5.5",
    direction: "back-to-back",
    trainerCompleted: trainerDone,
    participantRejected: participantRejection,
    passed: trainerDone && participantRejection,
  });
  console.log("  Trainer completed:", trainerDone);
  console.log("  Participant rejected:", participantRejection);

  // A5.1: Aggregate stats
  console.log("\n--- A5.1: Session Stats ---");
  const allGaps = results.tests.filter((t) => t.totalGap !== undefined).map((t) => t.totalGap);
  const allFb = results.tests.filter((t) => t.firstByteLatency !== undefined).map((t) => t.firstByteLatency);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const p95 = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return Math.round(s[Math.ceil(s.length * 0.95) - 1]);
  };

  const stats = {
    totalTurns: results.tests.filter((t) => t.firstByteLatency !== undefined).length,
    firstByteLatency: { avg: avg(allFb), min: Math.min(...allFb) || null, max: Math.max(...allFb) || null, p95: p95(allFb) },
    totalTurnGap: { avg: avg(allGaps), min: Math.min(...allGaps) || null, max: Math.max(...allGaps) || null, p95: p95(allGaps) },
  };
  results.stats = stats;
  console.log("  Total turns:", stats.totalTurns);
  console.log("  FirstByte avg:", stats.firstByteLatency.avg, "ms");
  console.log("  FirstByte p95:", stats.firstByteLatency.p95, "ms");
  console.log("  TotalGap avg:", stats.totalTurnGap.avg, "ms");
  console.log("  TotalGap p95:", stats.totalTurnGap.p95, "ms");

  // A5.7: Export JSON
  const fs = await import("node:fs");
  const outPath = `/tmp/a5-test-${code}.json`;
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("\n--- A5.7: Export JSON ---");
  console.log("  Exported to:", outPath);

  // Cleanup
  trainer.ws.close();
  p1.ws.close();
  p2.ws.close();
  p3.ws.close();

  // Summary
  const passed = results.tests.filter((t) => t.passed).length;
  const total = results.tests.length;
  console.log("\n========== SUMMARY ==========");
  console.log(`Passed: ${passed}/${total}`);
  console.log(`First Byte Latency: ${stats.firstByteLatency.avg}ms (avg), ${stats.firstByteLatency.p95}ms (p95)`);
  console.log(`Total Turn Gap: ${stats.totalTurnGap.avg}ms (avg), ${stats.totalTurnGap.p95}ms (p95)`);
  console.log("=============================\n");

  return results;
}

runTest().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
