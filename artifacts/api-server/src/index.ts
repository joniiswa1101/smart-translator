import app from "./app";
import { attachWebSocketProxy } from "./ws";
import { attachRoomWebSocket } from "./room-ws";
import { attachRoom2WebSocket } from "./room2-ws";
import { logger } from "./lib/logger";
import { ensureDefaultApiKey } from "./lib/default-key";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure default API key exists before starting server
await ensureDefaultApiKey();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Attach WebSocket proxies on the same port
attachWebSocketProxy(server);
attachRoomWebSocket(server);
attachRoom2WebSocket(server);
