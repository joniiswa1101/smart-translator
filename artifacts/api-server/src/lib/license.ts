import { db, devicesTable, usageLogsTable } from "@workspace/db";
import { eq, and, sql, count, sum } from "drizzle-orm";
import { logger } from "./logger";

export interface LicenseCheck {
  allowed: boolean;
  tier: "free" | "pro";
  turnsUsed: number;
  turnsLimit: number;
  participantsUsed: number;
  participantsLimit: number;
  message?: string;
}

const FREE_TURNS_LIMIT = 5;
const FREE_PARTICIPANTS_LIMIT = 2;
const PRO_TURNS_LIMIT = Infinity;
const PRO_PARTICIPANTS_LIMIT = Infinity;

function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getOrCreateDevice(deviceId: string, fingerprint?: string): Promise<{ id: number; tier: string; deviceId: string }> {
  const existing = await db.select().from(devicesTable).where(eq(devicesTable.deviceId, deviceId)).limit(1);
  if (existing.length > 0) {
    return existing[0];
  }
  const inserted = await db.insert(devicesTable).values({
    deviceId,
    fingerprint: fingerprint || null,
    tier: "free",
  }).returning();
  logger.info({ deviceId }, "New device registered");
  return inserted[0];
}

export async function checkLicense(deviceId: string, roomParticipantCount: number): Promise<LicenseCheck> {
  const device = await getOrCreateDevice(deviceId);
  const monthKey = getMonthKey();

  if (device.tier === "pro") {
    return {
      allowed: true,
      tier: "pro",
      turnsUsed: 0,
      turnsLimit: PRO_TURNS_LIMIT,
      participantsUsed: roomParticipantCount,
      participantsLimit: PRO_PARTICIPANTS_LIMIT,
    };
  }

  // Free tier: count turns this month
  const usageResult = await db
    .select({ totalTurns: sum(usageLogsTable.count) })
    .from(usageLogsTable)
    .where(
      and(
        eq(usageLogsTable.deviceId, deviceId),
        eq(usageLogsTable.monthKey, monthKey),
        eq(usageLogsTable.action, "turn_request")
      )
    );

  const turnsUsed = Number(usageResult[0]?.totalTurns || 0);

  if (turnsUsed >= FREE_TURNS_LIMIT) {
    return {
      allowed: false,
      tier: "free",
      turnsUsed,
      turnsLimit: FREE_TURNS_LIMIT,
      participantsUsed: roomParticipantCount,
      participantsLimit: FREE_PARTICIPANTS_LIMIT,
      message: `Free tier limit reached: ${turnsUsed}/${FREE_TURNS_LIMIT} turns this month. Upgrade to Pro for unlimited usage.`,
    };
  }

  if (roomParticipantCount > FREE_PARTICIPANTS_LIMIT) {
    return {
      allowed: false,
      tier: "free",
      turnsUsed,
      turnsLimit: FREE_TURNS_LIMIT,
      participantsUsed: roomParticipantCount,
      participantsLimit: FREE_PARTICIPANTS_LIMIT,
      message: `Free tier limit: max ${FREE_PARTICIPANTS_LIMIT} participants. Current: ${roomParticipantCount}. Upgrade to Pro for unlimited participants.`,
    };
  }

  return {
    allowed: true,
    tier: "free",
    turnsUsed,
    turnsLimit: FREE_TURNS_LIMIT,
    participantsUsed: roomParticipantCount,
    participantsLimit: FREE_PARTICIPANTS_LIMIT,
  };
}

export async function recordUsage(deviceId: string, action: string, roomCode?: string, count: number = 1): Promise<void> {
  const monthKey = getMonthKey();
  try {
    await db.insert(usageLogsTable).values({
      deviceId,
      roomCode: roomCode || null,
      action,
      count,
      monthKey,
    });
  } catch (err) {
    logger.error({ err, deviceId, action }, "Failed to record usage");
  }
}

export async function getUsageStats(deviceId: string): Promise<{ turnsThisMonth: number; tier: string }> {
  const device = await getOrCreateDevice(deviceId);
  const monthKey = getMonthKey();
  const result = await db
    .select({ total: sum(usageLogsTable.count) })
    .from(usageLogsTable)
    .where(
      and(
        eq(usageLogsTable.deviceId, deviceId),
        eq(usageLogsTable.monthKey, monthKey),
        eq(usageLogsTable.action, "turn_request")
      )
    );
  return {
    turnsThisMonth: Number(result[0]?.total || 0),
    tier: device.tier,
  };
}

export async function upgradeToPro(deviceId: string): Promise<boolean> {
  try {
    await db.update(devicesTable)
      .set({ tier: "pro", updatedAt: new Date() })
      .where(eq(devicesTable.deviceId, deviceId));
    logger.info({ deviceId }, "Device upgraded to Pro");
    return true;
  } catch (err) {
    logger.error({ err, deviceId }, "Failed to upgrade device");
    return false;
  }
}
