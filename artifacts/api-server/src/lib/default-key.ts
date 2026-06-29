import { db, apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_KEY = "sk_tr_default";

/**
 * Ensures a default platform API key exists in the database.
 * Called once at server startup so the primary user can connect
 * without manually generating or entering a key.
 */
export async function ensureDefaultApiKey(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.key, DEFAULT_KEY));

    if (rows.length === 0) {
      await db.insert(apiKeysTable).values({
        key: DEFAULT_KEY,
        name: "Default Platform Key",
        companyId: null,
        active: true,
      });
      logger.info("Created default platform API key");
    } else if (!rows[0].active) {
      await db
        .update(apiKeysTable)
        .set({ active: true })
        .where(eq(apiKeysTable.id, rows[0].id));
      logger.info("Re-activated default platform API key");
    }
  } catch (err) {
    logger.error({ err }, "Failed to ensure default API key");
  }
}
