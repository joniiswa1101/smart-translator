import { WebSocketServer, WebSocket } from "ws";
import { Server, type IncomingMessage } from "http";
import { logger } from "./lib/logger";

const API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

// Shared WebSocket server for proxy (noServer: true)
const proxyWss = new WebSocketServer({ noServer: true });

proxyWss.on("connection", (clientWs: WebSocket) => {
  logger.info("Client connected to WebSocket proxy");

  let openaiWs: WebSocket | null = null;
  let clientClosed = false;
  let openaiClosed = false;

  openaiWs = new WebSocket(OPENAI_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  openaiWs.on("open", () => {
    logger.info("Connected to OpenAI Realtime");
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
    logger.error({ err }, "OpenAI WebSocket error");
    if (!clientClosed) {
      clientWs.send(JSON.stringify({ type: "proxy.error", error: err.message }));
    }
  });

  openaiWs.on("close", () => {
    openaiClosed = true;
    logger.info("OpenAI WebSocket closed");
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
    logger.error({ err }, "Client WebSocket error");
  });

  clientWs.on("close", () => {
    clientClosed = true;
    logger.info("Client disconnected");
    if (openaiWs && !openaiClosed) {
      openaiWs.close();
    }
  });
});

export function attachWebSocketProxy(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url === "/ws") {
      proxyWss.handleUpgrade(req, socket, head, (ws) => {
        proxyWss.emit("connection", ws, req);
      });
    }
  });
  logger.info("WebSocket proxy upgrade handler attached for /ws");
}
