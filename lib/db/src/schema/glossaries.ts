import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Custom glossary per-company/room — company-specific terminology overrides
export const glossariesTable = pgTable("glossaries", {
  id: serial("id").primaryKey(),
  companyId: text("company_id").notNull(), // e.g. "room-{code}" or "company-{slug}"
  term: text("term").notNull(),
  sourceLang: text("source_lang").notNull(),
  targetLang: text("target_lang").notNull(),
  translation: text("translation").notNull(),
  context: text("context"), // optional: "product name", "SOP", "jargon"
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const insertGlossarySchema = createInsertSchema(glossariesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGlossary = z.infer<typeof insertGlossarySchema>;
export type Glossary = typeof glossariesTable.$inferSelect;
