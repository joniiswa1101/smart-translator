import { WebSocketServer, WebSocket } from "ws";
import { Server, type IncomingMessage } from "http";
import { logger } from "./lib/logger";
import { checkRateLimit, trackWsConnection, releaseWsConnection } from "./lib/rate-limit";
import { consumeProxyToken } from "./lib/nonce-store";

const API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

/** Max concurrent /ws proxy connections per IP */
const WS_PROXY_MAX_CONCURRENT = 2;
/** Max new /ws proxy connections per IP per minute */
const WS_PROXY_RATE_LIMIT = { name: "ws-proxy", windowMs: 60_000, max: 5 };

function getIp(req: IncomingMessage): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// Shared WebSocket server for proxy (noServer: true)
const proxyWss = new WebSocketServer({ noServer: true });

proxyWss.on("connection", (clientWs: WebSocket, req: IncomingMessage) => {
  const ip = getIp(req);

  logger.info({ ip }, "Client connected to WebSocket proxy");

  let openaiWs: WebSocket | null = null;
  let clientClosed = false;
  let openaiClosed = false;

  openaiWs = new WebSocket(OPENAI_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  openaiWs.on("open", () => {
    logger.info({ ip }, "Connected to OpenAI Realtime");
    clientWs.send(JSON.stringify({ type: "proxy.ready" }));
  });

  openaiWs.on("message", (data) => {
    if (clientClosed) return;
    try {
      const text = data instanceof Buffer ? data.toString("utf8") : data;
      clientWs.send(text);
    } catch {
      // client closed
    }
  });

  openaiWs.on("error", (err) => {
    logger.error({ err, ip }, "OpenAI WebSocket error");
    if (!clientClosed) {
      clientWs.send(JSON.stringify({ type: "proxy.error", error: err.message }));
    }
  });

  openaiWs.on("close", () => {
    openaiClosed = true;
    logger.info({ ip }, "OpenAI WebSocket closed");
    if (!clientClosed) {
      clientWs.close();
    }
  });

  clientWs.on("message", (data) => {
    if (openaiClosed || !openaiWs) return;
    try {
      const text = data instanceof Buffer ? data.toString("utf8") : data;
      openaiWs.send(text);
    } catch {
      // openai closed
    }
  });

  clientWs.on("error", (err) => {
    logger.error({ err, ip }, "Client WebSocket error");
  });

  clientWs.on("close", () => {
    clientClosed = true;
    releaseWsConnection(ip);
    logger.info({ ip }, "Client disconnected from proxy");
    if (openaiWs && !openaiClosed) {
      openaiWs.close();
    }
  });
});

export function attachWebSocketProxy(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      const ip = getIp(req);

      // Parse query string from the upgrade URL to extract the proxy token.
      const queryString = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
      const params = new URLSearchParams(queryString);
      const proxyToken = params.get("proxy_token") ?? "";

      // Validate the one-time proxy token issued by POST /api/session.
      // Rejects connections that did not go through the authorized session flow.
      if (!proxyToken || !consumeProxyToken(proxyToken)) {
        logger.warn({ ip }, "WebSocket proxy rejected: missing or invalid proxy_token");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Rate-limit new connection attempts per IP
      if (!checkRateLimit(ip, WS_PROXY_RATE_LIMIT)) {
        logger.warn({ ip }, "WebSocket proxy rate limit exceeded");
        socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        socket.destroy();
        return;
      }

      // Limit concurrent connections per IP
      if (!trackWsConnection(ip, WS_PROXY_MAX_CONCURRENT)) {
        logger.warn({ ip }, "WebSocket proxy concurrent connection limit exceeded");
        socket.write("HTTP/1.1 429 Too Many Connections\r\n\r\n");
        socket.destroy();
        return;
      }

      proxyWss.handleUpgrade(req, socket, head, (ws) => {
        proxyWss.emit("connection", ws, req);
      });
    }
  });
  logger.info("WebSocket proxy upgrade handler attached for /ws");
}
