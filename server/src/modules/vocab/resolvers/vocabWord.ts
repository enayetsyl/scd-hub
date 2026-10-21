/**
 * Vocabulary word-bank resolvers (VC-1; prd-vocabulary-tracker §3.2/§7 J1, D-#104/
 * #105/#126).
 *
 * RBAC (D-#126 — composes existing perms, NO new permission, the D-#94 pattern):
 *   - READ (`vocabWords` / `vocabWord`): `vocab_test:view` (Principal/Teacher). The
 *     word bank is shared content (no identity), so reading is not class-level
 *     restricted — any holder of vocab_test:view may browse any bank.
 *   - WRITE (add/edit/(de)activate): `vocab_test:edit` (the J1 actor — "a teacher
 *     with vocab_test:edit on a class") PLUS class-level write-reach: a TEACHER may
 *     manage only the bank of a class level they hold a teaching/proxy scope on
 *     (PoLP); vocab_test:edit_all (Principal by default) is unscoped; OFFICE/GUARDIAN are denied (they lack
 *     vocab_test:edit — the weekly TESTER assignment is the vocab_test:assign surface at
 *     VC-2, a separate admin action).
 *
 * Identity/operational plane; NO corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  addVocabWord,
  editVocabWord,
  setVocabWordActive,
  listVocabWords,
  getVocabWord,
} from "../services/VocabWordService";
import { assertCanManageClassLevel } from "../services/vocabGate";
import type { IVocabWord } from "../models/VocabWord";

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
// Mutations (vocab_test:edit + class-level reach)
// ---------------------------------------------------------------------------

builder.mutationField("addVocabWord", (t) =>
  t.field({
    type: VocabWordRef,
    description:
      "Add a word to a (program × classLevel) bank (J1). Requires vocab_test:edit + a " +
      "teaching/proxy scope on that class level (Principal unscoped). Audited.",
    authScopes: { hasAnyPermission: ["vocab_test:edit", "vocab_test:edit_all"] },
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
      "Edit a word's headword and/or Bangla meaning. Requires vocab_test:edit + reach " +
      "on the word's class level (Principal unscoped). Audited.",
    authScopes: { hasAnyPermission: ["vocab_test:edit", "vocab_test:edit_all"] },
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
      "vocab_test:edit + reach on the word's class level (Principal unscoped). Audited.",
    authScopes: { hasAnyPermission: ["vocab_test:edit", "vocab_test:edit_all"] },
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
// Queries (vocab_test:view — shared content, not class-level restricted)
// ---------------------------------------------------------------------------

builder.queryField("vocabWords", (t) =>
  t.field({
    type: [VocabWordRef],
    description:
      "The word bank for a (program × classLevel). Active rows by default; " +
      "includeInactive surfaces deactivated words. Requires vocab_test:view.",
    authScopes: { hasPermission: "vocab_test:view" },
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
    description: "One word by id (VC-1). Requires vocab_test:view.",
    authScopes: { hasPermission: "vocab_test:view" },
    args: { wordId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => getVocabWord(args.wordId) as unknown as Promise<IVocabWord | null>,
  }),
);
