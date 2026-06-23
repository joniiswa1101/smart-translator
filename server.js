import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/api/session", async (req, res) => {
  try {
    const targetLanguage = req.body.targetLanguage || "en";

    console.log(
      `[${new Date().toISOString()}] Minting ephemeral key for target language: ${targetLanguage}`,
    );

    const response = await openai.beta.realtime.sessions.create({
      model: "gpt-realtime-translate",
      modalities: ["text", "audio"],
      voice: "alloy",
      instructions: `You are a professional interpreter. Translate speech from Indonesian to ${targetLanguage === "en" ? "English" : "Indonesian"}. Be precise and maintain the original meaning.`,
      audio: {
        provider: "openai",
        voice: "alloy",
      },
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
    });

    console.log(
      `[${new Date().toISOString()}] Ephemeral key minted successfully`,
    );

    res.json({
      client_secret: response.client_secret.value,
      expires_at: response.client_secret.expires_at,
    });
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error minting ephemeral key:`,
      error.message,
    );
    res.status(500).json({
      error: "Failed to mint ephemeral key",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`Interpreter Latency Test Server`);
  console.log(`========================================`);
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log(`API endpoint: POST /api/session`);
  console.log(
    `OpenAI API Key: ${process.env.OPENAI_API_KEY ? "✓ Configured" : "✗ Missing"}`,
  );
  console.log(`========================================\n`);
});
