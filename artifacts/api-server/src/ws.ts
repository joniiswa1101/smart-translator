import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { logger } from "./lib/logger";

const API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

export function attachWebSocketProxy(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (clientWs: WebSocket) => {
    logger.info("Client connected to WebSocket proxy");

    let openaiWs: WebSocket | null = null;
    let clientClosed = false;
    let openaiClosed = false;

    // Connect to OpenAI
    openaiWs = new WebSocket(OPENAI_URL, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
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

    // From client → OpenAI
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

  logger.info("WebSocket proxy attached at /ws");
}
