/**
 * myWritableSubjects — which subjects the caller can ACT on in a section's homework /
 * assignment workspace (owner report 2026-11-01).
 *
 * The workspaces fold every subject the caller does not teach there into a read-only
 * card (D-#388). Teaching/proxy grants decide what is "taught" — but not what may be
 * written: a whole-school delegation (ACS-1) or the tracker's edit_all reach writes
 * every subject. This answers the write half with the mutations' own gate
 * (writableSubjectIds ≡ assertCanWriteAny over the card's three duties — the same set
 * the undo gate names), so a folded card keeps its controls exactly when its taps
 * would succeed. Display only: every mutation still runs its own gate.
 */
import type { DelegatedAction } from "@scd/shared";
import { builder } from "../../../schema";
import { writableSubjectIds, type Reach } from "../../../middleware/authz";
import { Subject } from "../../foundation/models/Subject";

const TRACKERS: Record<string, { actions: DelegatedAction[]; reach: Reach }> = {
  HOMEWORK: {
    actions: ["declare_homework", "submit_homework", "check_homework"],
    reach: { editAll: "homework:edit_all" },
  },
  ASSIGNMENT: {
    actions: ["declare_assignment", "submit_assignment", "check_assignment"],
    reach: { editAll: "assignment:edit_all" },
  },
};

builder.queryField("myWritableSubjects", (t) =>
  t.stringList({
    nullable: true,
    authScopes: { authenticated: true },
    description:
      "Subject CODES the caller may act on in this section's HOMEWORK or ASSIGNMENT " +
      "workspace (any of declare/submit/check — the mutations' own gate). null = every " +
      "subject (edit_all reach / Principal). Drives the not-my-subject fold's read-only state.",
    args: {
      sectionId: t.arg.string({ required: true }),
      tracker: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const tracker = TRACKERS[args.tracker];
      if (!tracker) throw new Error("tracker must be HOMEWORK or ASSIGNMENT");
      const subjects = await Subject.find({}).select("code").lean();
      const ids = await writableSubjectIds(
        ctx,
        args.sectionId,
        subjects.map((s) => s._id.toString()),
        tracker.actions,
        tracker.reach,
      );
      if (ids === null) return null;
      return subjects.filter((s) => ids.has(s._id.toString())).map((s) => s.code);
    },
  }),
);
