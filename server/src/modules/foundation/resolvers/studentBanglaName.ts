/**
 * Students' Bangla names (AI-4, D-#1131) — the Office fills them so the AI can hide them.
 * `students:edit`; the readiness count is also open to `system_health:ai_key` (Principal).
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { banglaNameReadiness, setStudentBanglaName, studentBanglaNamesPage, type BanglaNameRow } from "../services/StudentBanglaNameService";
import type { DeidReadiness } from "../../platform/services/DeidScopeService";

const BanglaNameRowRef = builder.objectRef<BanglaNameRow>("StudentBanglaNameRow").implement({
  fields: (t) => ({
    studentId: t.string({ resolve: (r) => r.studentId }),
    schoolId: t.string({ resolve: (r) => r.schoolId }),
    name: t.string({ resolve: (r) => r.name }),
    nameBn: t.string({ nullable: true, resolve: (r) => r.nameBn }),
    guessBn: t.string({ description: "Bangla spelling guessed from the English name (D-#1151); empty when none.", resolve: (r) => r.guessBn }),
    placeBn: t.string({ description: "Class · section, in Bangla.", resolve: (r) => r.placeBn }),
  }),
});

const BanglaNamePageRef = pageRef("StudentBanglaNamePage", BanglaNameRowRef);

const ReadinessRef = builder.objectRef<DeidReadiness>("BanglaNameReadiness").implement({
  fields: (t) => ({
    activeStudents: t.int({ resolve: (r) => r.activeStudents }),
    withBanglaName: t.int({ resolve: (r) => r.withBanglaName }),
    missingBanglaName: t.int({ resolve: (r) => r.missingBanglaName }),
  }),
});

builder.queryField("studentBanglaNamesPage", (t) =>
  t.field({
    type: BanglaNamePageRef,
    description: "Active students for filling Bangla names (missing ones only unless missingOnly=false). students:edit.",
    authScopes: { hasPermission: "students:edit" },
    args: { page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }), missingOnly: t.arg.boolean({ required: false }) },
    resolve: (_r, args, ctx) => studentBanglaNamesPage(ctx.auth, { page: args.page, pageSize: args.pageSize, missingOnly: args.missingOnly }),
  }),
);

builder.queryField("banglaNameReadiness", (t) =>
  t.field({
    type: ReadinessRef,
    description: "How many active students have a Bangla name (the AI can hide only names it knows). students:edit or system_health:ai_key.",
    authScopes: { hasAnyPermission: ["students:edit", "system_health:ai_key"] },
    resolve: (_r, _a, ctx) => banglaNameReadiness(ctx.auth),
  }),
);

builder.mutationField("setStudentBanglaName", (t) =>
  t.field({
    type: BanglaNameRowRef,
    description: "Set one student's Bangla name (Bangla letters, 2–80). Audited. students:edit.",
    authScopes: { hasPermission: "students:edit" },
    args: { studentId: t.arg.string({ required: true }), nameBn: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => setStudentBanglaName(ctx.auth, args.studentId, args.nameBn),
  }),
);
