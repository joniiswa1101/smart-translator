import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usageLogsTable = pgTable("usage_logs", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  roomCode: text("room_code"),
  action: text("action").notNull(), // 'turn_request' | 'translation' | 'join_room'
  count: integer("count").notNull().default(1),
  monthKey: text("month_key").notNull(), // '2026-06' format
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertUsageLogSchema = createInsertSchema(usageLogsTable).omit({ id: true, createdAt: true });
export type InsertUsageLog = z.infer<typeof insertUsageLogSchema>;
export type UsageLog = typeof usageLogsTable.$inferSelect;
