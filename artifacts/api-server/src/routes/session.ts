import { Router, type IRouter } from "express";
import { rateLimitMiddleware } from "../lib/rate-limit";
import { apiKeyAuth } from "../middleware/api-auth";
import { issueProxyToken } from "../lib/nonce-store";

const router: IRouter = Router();

const API_KEY = process.env["OPENAI_API_KEY"];

/**
 * Rate limit as defence-in-depth (after apiKeyAuth already gates access).
 */
const sessionRateLimit = rateLimitMiddleware({
  name: "session",
  windowMs: 60_000,
  max: 10,
});

/**
 * POST /api/session
 *
 * Requires a valid X-API-Key header (platform API key checked against DB).
 * Only authenticated callers may spend backend OpenAI quota.
 *
 * If OpenAI ephemeral sessions are unavailable, returns a single-use
 * `proxy_token` that the client must present when upgrading to /ws.
 * The proxy token is scoped and expires in 5 minutes.
 */
router.post("/session", apiKeyAuth, sessionRateLimit, async (req, res) => {
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
      const data: any = await resp.json();
      res.json({
        client_secret: data.client_secret?.value ?? data.client_secret,
        expires_at: data.expires_at,
      });
      return;
    }

    // Fallback: ephemeral sessions not available for this key.
    // Issue a scoped single-use proxy token so the client can open /ws.
    // The proxy token is validated and consumed during the WebSocket upgrade.
    const body = await resp.text();
    req.log.warn({ status: resp.status, body }, "Ephemeral session unavailable; issuing proxy token for /ws fallback");
    const proxyToken = issueProxyToken();
    res.json({
      use_proxy: true,
      proxy_token: proxyToken,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
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
