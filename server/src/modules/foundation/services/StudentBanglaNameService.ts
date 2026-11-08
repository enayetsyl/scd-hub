/**
 * Students' Bangla names (AI-4, D-#1131; PRD P11) — the AI de-identification can only hide
 * a name it knows, and teachers write children's names in Bangla while most children have
 * only an English name on file. The Office fills them here. `students:edit`.
 */
import { Types } from "mongoose";
import type { AuthPayload } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import { pageOf, type Page, type PageArgs } from "../../../lib/paging";
import { Student } from "../models/Student";
import { Section } from "../models/Section";
import { Class } from "../models/Class";
import { writeAudit } from "../../platform/services/AuditService";
import { deidReadiness, type DeidReadiness } from "../../platform/services/DeidScopeService";

export interface BanglaNameRow {
  studentId: string;
  schoolId: string;
  name: string;
  nameBn: string | null;
  /** "শ্রেণি ৩ · বালক" */
  placeBn: string;
}

function assertEdit(auth: AuthPayload | null): AuthPayload {
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "students:edit")) throw new ForbiddenError("শিক্ষার্থীর তথ্য ঠিক করার অনুমতি নেই");
  return auth;
}

/** Active students, those WITHOUT a Bangla name first (or only them), in class / section / name order. */
export async function studentBanglaNamesPage(authIn: AuthPayload | null, args: PageArgs & { missingOnly?: boolean | null }): Promise<Page<BanglaNameRow>> {
  assertEdit(authIn);
  const filter: Record<string, unknown> = { active: { $ne: false } };
  if (args.missingOnly !== false) filter.nameBn = { $in: [null, ""] };
  const [students, sections, classes] = await Promise.all([
    Student.find(filter).select("schoolId name nameBn classId sectionId").lean(),
    Section.find({}).select("nameBn classId").lean(),
    Class.find({}).select("nameBn level").lean(),
  ]);
  const sec = new Map(sections.map((s) => [s._id.toString(), s]));
  const cls = new Map(classes.map((c) => [c._id.toString(), c]));
  const rows = students
    .map((s) => {
      const c = cls.get(s.classId.toString());
      const se = sec.get(s.sectionId.toString());
      return {
        level: (c as { level?: number } | undefined)?.level ?? 99,
        row: {
          studentId: s._id.toString(),
          schoolId: s.schoolId,
          name: s.name,
          nameBn: s.nameBn || null,
          placeBn: [c?.nameBn, se?.nameBn].filter(Boolean).join(" · "),
        },
      };
    })
    .sort((a, b) => a.level - b.level || a.row.placeBn.localeCompare(b.row.placeBn) || a.row.name.localeCompare(b.row.name))
    .map((x) => x.row);
  return pageOf(rows, args);
}

/** Set one student's Bangla name. Must contain Bangla letters; audited with before/after. */
export async function setStudentBanglaName(authIn: AuthPayload | null, studentId: string, nameBnIn: string): Promise<BanglaNameRow> {
  const auth = assertEdit(authIn);
  if (!Types.ObjectId.isValid(studentId)) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
  const nameBn = (nameBnIn ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (nameBn.length < 2 || nameBn.length > 80) throw new Error("বাংলা নাম ২ থেকে ৮০ অক্ষরের মধ্যে লিখুন");
  if (!/[ঀ-৿]/.test(nameBn)) throw new Error("নামটি বাংলা অক্ষরে লিখুন");
  const s = await Student.findById(studentId);
  if (!s) throw new Error("শিক্ষার্থী পাওয়া যায়নি");
  const before = s.nameBn ?? null;
  s.nameBn = nameBn;
  await s.save();
  await writeAudit({
    eventKind: "STUDENT_BANGLA_NAME_SET",
    actorId: auth.userId,
    actorRole: auth.role,
    targetKind: "Student",
    targetId: s._id.toString(),
    meta: { before, after: nameBn },
  });
  const [c, se] = await Promise.all([Class.findById(s.classId).select("nameBn").lean(), Section.findById(s.sectionId).select("nameBn").lean()]);
  return { studentId: s._id.toString(), schoolId: s.schoolId, name: s.name, nameBn, placeBn: [c?.nameBn, se?.nameBn].filter(Boolean).join(" · ") };
}

export async function banglaNameReadiness(authIn: AuthPayload | null): Promise<DeidReadiness> {
  const auth = authIn;
  if (!auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(auth, "students:edit") && !callerHasPermission(auth, "system_health:ai_key")) {
    throw new ForbiddenError("এই তথ্য দেখার অনুমতি নেই");
  }
  return deidReadiness();
}
