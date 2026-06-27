import { Request, Response, NextFunction } from "express";
import { db, apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Attach API key metadata to request for downstream use
declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: number;
        name: string;
        companyId: string | null;
      };
    }
  }
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key) {
    res.status(401).json({ error: "Missing X-API-Key header" });
    return;
  }

  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.key, key));

  if (rows.length === 0 || !rows[0].active) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }

  req.apiKey = {
    id: rows[0].id,
    name: rows[0].name,
    companyId: rows[0].companyId || null,
  };

  // Update last used
  await db
    .update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, rows[0].id));

  next();
}
