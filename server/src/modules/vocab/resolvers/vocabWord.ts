/**
 * Vocabulary word-bank resolvers (VC-1; prd-vocabulary-tracker §3.2/§7 J1, D-#104/
 * #105/#126).
 *
 * RBAC (D-#126 — composes existing perms, NO new permission, the D-#94 pattern):
 *   - READ (`vocabWords` / `vocabWord`): `tracker:read` (Principal/Teacher). The
 *     word bank is shared content (no identity), so reading is not class-level
 *     restricted — any holder of tracker:read may browse any bank.
 *   - WRITE (add/edit/(de)activate): `tracker:write` (the J1 actor — "a teacher
 *     with tracker:write on a class") PLUS class-level write-reach: a TEACHER may
 *     manage only the bank of a class level they hold a teaching/proxy scope on
 *     (PoLP); the PRINCIPAL is unscoped; OFFICE/GUARDIAN are denied (they lack
 *     tracker:write — the weekly TESTER assignment is the roster:manage surface at
 *     VC-2, a separate admin action).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError, resolveTeacherScopes } from "../../../middleware/authz";
import type { AppContext } from "../../../context";
import { Class } from "../../foundation/models/Class";
import {
  addVocabWord,
  editVocabWord,
  setVocabWordActive,
  listVocabWords,
  getVocabWord,
} from "../services/VocabWordService";
import type { IVocabWord } from "../models/VocabWord";

// ---------------------------------------------------------------------------
// Class-level write-reach gate (J1 / D-#126)
// ---------------------------------------------------------------------------

/**
 * Assert the caller may MANAGE the (program-agnostic) word bank for `classLevel`.
 * Principal → unscoped. Teacher → must hold a teaching/proxy scope on a section
 * whose class sits at `classLevel`. Office/Guardian → denied (no tracker:write).
 *
 * This mirrors `assertCanWrite` (which is section-keyed) but resolves to a CLASS
 * LEVEL, since the word bank is per (program × classLevel), not per section.
 */
async function assertCanManageClassLevel(ctx: AppContext, classLevel: number): Promise<void> {
  if (ctx.auth?.role === "PRINCIPAL") return;
  if (ctx.auth?.role !== "TEACHER") throw new ForbiddenError();
  const scopes = await resolveTeacherScopes(ctx);
  const writableClassIds = scopes
    .filter((s) => s.kind === "teaching" || s.kind === "proxy")
    .map((s) => (s as { classId: string }).classId);
  if (writableClassIds.length === 0) throw new ForbiddenError();
  const match = await Class.findOne({ _id: { $in: writableClassIds }, level: classLevel })
    .select("_id")
    .lean();
  if (!match) {
    throw new ForbiddenError("You may only manage the word bank for a class level you teach");
  }
}

// ---------------------------------------------------------------------------
// GraphQL shape
// ---------------------------------------------------------------------------

const VocabWordRef = builder.objectRef<IVocabWord>("VocabWord");
VocabWordRef.implement({
  description: "A reusable word in a (program × classLevel) word bank (VC-1; prd-vocabulary-tracker §3.2).",
  fields: (t) => ({
    id: t.string({ resolve: (w) => w._id.toString() }),
    program: t.exposeString("program"),
    classLevel: t.exposeInt("classLevel"),
    headword: t.exposeString("headword"),
    banglaMeaning: t.exposeString("banglaMeaning"),
    active: t.exposeBoolean("active"),
    addedBy: t.string({ resolve: (w) => w.addedBy.toString() }),
    addedOn: t.string({ resolve: (w) => new Date(w.createdAt).toISOString() }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations (tracker:write + class-level reach)
// ---------------------------------------------------------------------------

builder.mutationField("addVocabWord", (t) =>
  t.field({
    type: VocabWordRef,
    description:
      "Add a word to a (program × classLevel) bank (J1). Requires tracker:write + a " +
      "teaching/proxy scope on that class level (Principal unscoped). Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      program: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      headword: t.arg.string({ required: true }),
      banglaMeaning: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      await assertCanManageClassLevel(ctx, args.classLevel);
      return addVocabWord({
        program: args.program,
        classLevel: args.classLevel,
        headword: args.headword,
        banglaMeaning: args.banglaMeaning,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("editVocabWord", (t) =>
  t.field({
    type: VocabWordRef,
    description:
      "Edit a word's headword and/or Bangla meaning. Requires tracker:write + reach " +
      "on the word's class level (Principal unscoped). Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      wordId: t.arg.string({ required: true }),
      headword: t.arg.string({ required: false }),
      banglaMeaning: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const existing = await getVocabWord(args.wordId);
      if (!existing) throw new ForbiddenError("Word not found");
      await assertCanManageClassLevel(ctx, existing.classLevel);
      return editVocabWord({
        wordId: args.wordId,
        headword: args.headword ?? undefined,
        banglaMeaning: args.banglaMeaning ?? undefined,
        actorId: ctx.auth!.userId,
      });
    },
  }),
);

builder.mutationField("setVocabWordActive", (t) =>
  t.field({
    type: VocabWordRef,
    description:
      "Deactivate or reactivate a word (soft, never deleted — D-#104). Requires " +
      "tracker:write + reach on the word's class level (Principal unscoped). Audited.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      wordId: t.arg.string({ required: true }),
      active: t.arg.boolean({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const existing = await getVocabWord(args.wordId);
      if (!existing) throw new ForbiddenError("Word not found");
      await assertCanManageClassLevel(ctx, existing.classLevel);
      return setVocabWordActive(args.wordId, args.active, ctx.auth!.userId);
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries (tracker:read — shared content, not class-level restricted)
// ---------------------------------------------------------------------------

builder.queryField("vocabWords", (t) =>
  t.field({
    type: [VocabWordRef],
    description:
      "The word bank for a (program × classLevel). Active rows by default; " +
      "includeInactive surfaces deactivated words. Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      program: t.arg.string({ required: true }),
      classLevel: t.arg.int({ required: true }),
      includeInactive: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) =>
      listVocabWords({
        program: args.program,
        classLevel: args.classLevel,
        includeInactive: args.includeInactive ?? false,
      }) as unknown as Promise<IVocabWord[]>,
  }),
);

builder.queryField("vocabWord", (t) =>
  t.field({
    type: VocabWordRef,
    nullable: true,
    description: "One word by id (VC-1). Requires tracker:read.",
    authScopes: { hasPermission: "tracker:read" },
    args: { wordId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getVocabWord(args.wordId) as unknown as Promise<IVocabWord | null>,
  }),
);
