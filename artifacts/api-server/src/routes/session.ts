import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

router.post("/session", async (req, res) => {
  try {
    const response = await (openai.beta as any).realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2025-06-03",
    });

    res.json({
      client_secret: response.client_secret?.value ?? response.client_secret,
      expires_at: response.expires_at,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to create realtime session");
    res.status(500).json({
      error: "Failed to create session",
      details: err?.message ?? String(err),
    });
  }
});

export default router;
