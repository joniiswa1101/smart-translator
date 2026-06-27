import { Router, type IRouter } from "express";
import { checkLicense, getUsageStats, upgradeToPro } from "../lib/license";

const router: IRouter = Router();

// GET /api/license?deviceId=xxx&participants=N
router.get("/license", async (req, res) => {
  const deviceId = req.query.deviceId as string;
  const participants = parseInt(req.query.participants as string) || 1;
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  const result = await checkLicense(deviceId, participants);
  res.json(result);
});

// GET /api/usage?deviceId=xxx
router.get("/usage", async (req, res) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  const stats = await getUsageStats(deviceId);
  res.json(stats);
});

// POST /api/upgrade { deviceId }
router.post("/upgrade", async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  const success = await upgradeToPro(deviceId);
  if (success) {
    res.json({ success: true, tier: "pro" });
  } else {
    res.status(500).json({ success: false, error: "Upgrade failed" });
  }
});

export default router;
