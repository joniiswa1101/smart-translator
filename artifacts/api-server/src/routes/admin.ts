import { Router, type IRouter } from "express";
import { db, devicesTable, usageLogsTable } from "@workspace/db";
import { getAllRooms2, getRoom2, getParticipantList2 } from "../room2";
import { sql, count, sum, eq, gte } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/admin/stats - Overall system stats
router.get("/admin/stats", async (_req, res) => {
  try {
    const rooms = getAllRooms2();
    const totalDevices = await db.select({ count: count() }).from(devicesTable);
    const freeDevices = await db.select({ count: count() }).from(devicesTable).where(eq(devicesTable.tier, "free"));
    const proDevices = await db.select({ count: count() }).from(devicesTable).where(eq(devicesTable.tier, "pro"));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayUsage = await db
      .select({ total: sum(usageLogsTable.count) })
      .from(usageLogsTable)
      .where(gte(usageLogsTable.createdAt, today));

    res.json({
      activeRooms: rooms.length,
      totalParticipants: rooms.reduce((acc, r) => acc + r.participants.size, 0),
      totalDevices: totalDevices[0]?.count || 0,
      freeDevices: freeDevices[0]?.count || 0,
      proDevices: proDevices[0]?.count || 0,
      turnsToday: Number(todayUsage[0]?.total || 0),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/admin/rooms - List all active rooms
router.get("/admin/rooms", (_req, res) => {
  const rooms = getAllRooms2();
  res.json(
    rooms.map((room) => ({
      code: room.code,
      participantCount: room.participants.size,
      currentSpeaker: room.currentSpeaker,
      isListening: room.isListening,
      isProcessing: room.isProcessing,
      turnsCount: room.turns.length,
      createdAt: room.createdAt,
      participants: getParticipantList2(room),
    })),
  );
});

// GET /api/admin/room/:code - Room detail
router.get("/admin/room/:code", (req, res) => {
  const room = getRoom2(req.params.code);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({
    code: room.code,
    participants: getParticipantList2(room),
    currentSpeaker: room.currentSpeaker,
    isListening: room.isListening,
    isProcessing: room.isProcessing,
    isPlaying: room.isPlaying,
    turns: room.turns,
    createdAt: room.createdAt,
  });
});

// GET /api/admin/usage - Usage breakdown
router.get("/admin/usage", async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daily = await db
      .select({
        day: sql<string>`DATE(${usageLogsTable.createdAt})`,
        total: sum(usageLogsTable.count),
      })
      .from(usageLogsTable)
      .groupBy(sql`DATE(${usageLogsTable.createdAt})`)
      .orderBy(sql`DATE(${usageLogsTable.createdAt})`)
      .limit(30);

    const byAction = await db
      .select({
        action: usageLogsTable.action,
        total: sum(usageLogsTable.count),
      })
      .from(usageLogsTable)
      .groupBy(usageLogsTable.action);

    res.json({ daily, byAction });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
