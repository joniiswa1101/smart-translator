import { WebSocket } from "ws";

const WS_URL = "ws://localhost:80/room2-ws";

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function test() {
  console.log("Creating room...");
  const resp = await fetch("http://localhost:80/api/room2", { method: "POST" });
  const { code } = await resp.json();
  console.log("Room:", code);

  const ws = await connect();
  ws.send(JSON.stringify({
    type: "room.join",
    code,
    name: "Trainer",
    role: "trainer",
    spokenLang: "id",
    hearLang: "en"
  }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    console.log("Received:", msg.type, msg.turnId || "");
    if (msg.type === "room.joined") {
      console.log("Joined! Participants:", msg.participants.length);
      
      // Test turn request
      ws.send(JSON.stringify({ type: "turn.request" }));
    }
    if (msg.type === "turn.granted") {
      console.log("Turn granted!");
      
      // Send fake audio (1s silent)
      const pcm = Buffer.alloc(24000 * 2);
      ws.send(JSON.stringify({ type: "audio.append", audio: pcm.toString("base64") }));
      ws.send(JSON.stringify({ type: "audio.commit" }));
    }
    if (msg.type === "turn.processing") {
      console.log("Processing...");
    }
    if (msg.type === "turn.completed") {
      console.log("Completed! Source:", msg.sourceText?.slice(0, 30));
      console.log("Translations:", msg.translations);
      console.log("Total gap:", msg.totalGap);
      ws.close();
      process.exit(0);
    }
    if (msg.type === "pipeline.error") {
      console.log("ERROR:", msg.error);
      ws.close();
      process.exit(1);
    }
  });
}

test();
