/**
 * The guardian's gentle homework-help note (AL-12, docs/prd-academic-loop-2027.md AC-H4, R16 + R32, D-#1676).
 *
 *   childHomeworkHelpNotes - the child's OWN linked guardian only (assertGuardianOfStudent). After the outcome
 *                            "অভিভাবক করে দিয়েছেন" a subject carries the sentence "বাড়ির কাজ শিশুকে নিজে করতে দিন" until the
 *                            end of that term. The type carries a subject code and the fixed sentence - NO case, NO
 *                            number, NO objective, NO outcome word. UNCLEAR and CHILD_DID never produce a note.
 *
 * Open to any login in the schema scan (the guardian plane); the link check is in the body.
 */
import { builder } from "../../../schema";
import { assertGuardianOfStudent } from "../../../middleware/authz";
import { guardianNotesFor, type GuardianHelpNote } from "../services/IntegrityTagService";

const NoteRef = builder.objectRef<GuardianHelpNote>("ChildHomeworkHelpNote");
NoteRef.implement({
  description: "A gentle note on one subject: let the child do the homework alone. No case, no number.",
  fields: (t) => ({ subject: t.exposeString("subject"), noteBn: t.exposeString("noteBn") }),
});

builder.queryField("childHomeworkHelpNotes", (t) =>
  t.field({
    type: [NoteRef],
    description: "The gentle homework-help notes for one of the caller's own children (guardian only), until the end of the term.",
    authScopes: { authenticated: true },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      await assertGuardianOfStudent(ctx, a.studentId);
      return guardianNotesFor(a.studentId);
    },
  }),
);
