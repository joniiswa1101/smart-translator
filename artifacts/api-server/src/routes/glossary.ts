import { Router, type IRouter } from "express";
import { db, glossariesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/glossary/:companyId — list custom glossary entries for a company
router.get("/glossary/:companyId", async (req, res) => {
  try {
    const companyId = req.params.companyId;
    const entries = await db
      .select()
      .from(glossariesTable)
      .where(and(eq(glossariesTable.companyId, companyId), eq(glossariesTable.active, true)));
    res.json({ companyId, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/glossary/:companyId — bulk upsert entries
router.post("/glossary/:companyId", async (req, res) => {
  try {
    const companyId = req.params.companyId;
    const { entries } = req.body as { entries: Array<{ term: string; sourceLang: string; targetLang: string; translation: string; context?: string }> };

    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: "entries array required" });
      return;
    }

    // Simple upsert: delete old, insert new (for MVP)
    await db.delete(glossariesTable).where(eq(glossariesTable.companyId, companyId));

    const toInsert = entries.map((e) => ({
      companyId,
      term: e.term,
      sourceLang: e.sourceLang,
      targetLang: e.targetLang,
      translation: e.translation,
      context: e.context || null,
      active: true,
    }));

    await db.insert(glossariesTable).values(toInsert);
    res.json({ companyId, inserted: toInsert.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/glossary/:companyId/:term — deactivate a single entry
router.delete("/glossary/:companyId/:term", async (req, res) => {
  try {
    const { companyId, term } = req.params;
    await db
      .update(glossariesTable)
      .set({ active: false })
      .where(and(eq(glossariesTable.companyId, companyId), eq(glossariesTable.term, term)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
