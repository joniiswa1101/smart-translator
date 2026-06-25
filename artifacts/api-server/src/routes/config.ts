import { Router, type IRouter } from "express";

const router: IRouter = Router();

// GET /api/config — expose runtime configuration for debugging
router.get("/config", (_req, res) => {
  res.json({
    asrModel: "gpt-4o-transcribe",
    asrEndpoint: "https://api.openai.com/v1/audio/transcriptions",
    hintLangs: ["id", "en"],
    lockHearLang: true,
  });
});

export default router;
