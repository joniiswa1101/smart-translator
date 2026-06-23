import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Dev script runs with cwd = artifacts/api-server/ → public at ./public
// Prod binary runs with cwd = workspace root      → public at ./artifacts/api-server/public
const devPublic = path.resolve(process.cwd(), "public");
const prodPublic = path.resolve(process.cwd(), "artifacts/api-server/public");
const publicDir = existsSync(devPublic) ? devPublic : prodPublic;

app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
