import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// POST /api/asr-test — transcribe uploaded audio for direct verification
router.post("/asr-test", async (req, res) => {
  try {
    const lang = (req.query.lang as string) || "auto";
    res.json({
      text: "(Mock result — actual audio endpoint needs streaming middleware)",
      model: "gpt-4o-transcribe",
      lang,
      note: "This endpoint requires audio upload. For now, the /api/config endpoint confirms the server configuration.",
    });
  } catch (e) {
    logger.error(e, "ASR test error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
