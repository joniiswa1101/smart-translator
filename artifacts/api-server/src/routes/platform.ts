import { Router, type IRouter } from "express";
import { db, apiKeysTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { apiKeyAuth } from "../middleware/api-auth";
import { getAllRooms2, getRoom2, getParticipantList2 } from "../room2";

const router: IRouter = Router();

// === Public admin API (requires API key) ===

// GET /api/platform/stats - System overview for dashboards
router.get("/platform/stats", apiKeyAuth, async (_req, res) => {
  try {
    const rooms = getAllRooms2();
    const totalDevices = await db.select().from(apiKeysTable); // placeholder: replace with actual stats
    res.json({
      activeRooms: rooms.length,
      totalParticipants: rooms.reduce((acc, r) => acc + r.participants.size, 0),
      rooms: rooms.map(r => ({
        code: r.code,
        participants: r.participants.size,
        currentSpeaker: r.currentSpeaker,
        turnsCount: r.turns.length,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/platform/room/:code - Room detail for LMS
router.get("/platform/room/:code", apiKeyAuth, (req, res) => {
  const room = getRoom2(String(req.params.code));
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({
    code: room.code,
    participants: getParticipantList2(room),
    turns: room.turns.map(t => ({
      turnId: t.turnId,
      speakerName: t.speakerName,
      sourceLang: t.sourceLang,
      sourceText: t.sourceText,
      translations: t.targets,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
    })),
    createdAt: room.createdAt,
  });
});

// POST /api/platform/room - Create room via API
router.post("/platform/room", apiKeyAuth, (req, res) => {
  const { createRoom2 } = require("../room2");
  const glossaryId = req.apiKey?.companyId || undefined;
  const code = createRoom2(glossaryId);
  res.json({ code, glossaryId: glossaryId || null });
});

// === Admin-only: API key management ===

// POST /api/platform/keys - Generate new API key
router.post("/platform/keys", async (req, res) => {
  try {
    const { name, companyId } = req.body as { name: string; companyId?: string };
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const key = "sk_tr_" + crypto.randomUUID().replace(/-/g, "");
    await db.insert(apiKeysTable).values({ key, name, companyId: companyId || null });
    res.json({ key, name, companyId: companyId || null });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/platform/keys - List keys
router.get("/platform/keys", async (_req, res) => {
  try {
    const rows = await db.select().from(apiKeysTable).orderBy(desc(apiKeysTable.createdAt));
    res.json({ keys: rows.map(r => ({ id: r.id, name: r.name, companyId: r.companyId, active: r.active, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/platform/keys/:id - Revoke key
router.delete("/platform/keys/:id", async (req, res) => {
  try {
    await db.update(apiKeysTable).set({ active: false }).where(eq(apiKeysTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
