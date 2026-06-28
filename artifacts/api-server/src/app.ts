import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Build an allowlist from REPLIT_DOMAINS (comma-separated) + localhost.
// Only origins in this list are granted CORS access; everything else gets
// a blocked CORS response instead of an open wildcard.
const replitDomains = (process.env["REPLIT_DOMAINS"] ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => `https://${d}`);

const allowedOrigins = new Set([
  ...replitDomains,
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
]);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    // Same-origin requests (no Origin header) are always allowed.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  credentials: false,
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Dev script runs with cwd = artifacts/api-server/ → public at ./public
// Prod binary runs with cwd = workspace root      → public at ./artifacts/api-server/public
const devPublic = path.resolve(process.cwd(), "public");
const prodPublic = path.resolve(process.cwd(), "artifacts/api-server/public");
const publicDir = existsSync(devPublic) ? devPublic : prodPublic;

// Disable caching for HTML so Replit's preview pane always gets fresh content
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  next();
});
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/room", (_req, res) => {
  res.sendFile(path.join(publicDir, "room.html"));
});

app.get("/room2", (_req, res) => {
  res.sendFile(path.join(publicDir, "room2.html"));
});

app.get("/asr-test", (_req, res) => {
  res.sendFile(path.join(publicDir, "asr-test.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

export default app;
