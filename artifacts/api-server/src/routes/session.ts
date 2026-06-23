import { Router, type IRouter } from "express";

const router: IRouter = Router();

const API_KEY = process.env["OPENAI_API_KEY"];

router.post("/session", async (req, res) => {
  try {
    // Try the ephemeral session endpoint first (preferred, secure)
    const resp = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2025-06-03",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
        }),
      },
    );

    if (resp.ok) {
      const data = await resp.json();
      res.json({
        client_secret: data.client_secret?.value ?? data.client_secret,
        expires_at: data.expires_at,
      });
      return;
    }

    // Fallback: ephemeral sessions not available for this key.
    // Return a placeholder that tells the frontend to use the local proxy.
    const body = await resp.text();
    req.log.warn({ status: resp.status, body }, "Ephemeral session unavailable; frontend will use local proxy");
    res.json({
      use_proxy: true,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
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
