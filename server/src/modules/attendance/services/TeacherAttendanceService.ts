/**
 * TeacherAttendanceService (AT-1, D-#63) — daily Excel snapshot ingest.
 *
 *   previewImport  — parse + name-match the uploaded file; nothing persisted.
 *                    The Admin resolves unmatched names from this view (AT1.6).
 *   commitImport   — persist the snapshot: remembered alias mappings are created
 *                    first (AT1.2), every row must then be matched or explicitly
 *                    ignored (no silent drop), and the date's rows are REPLACED
 *                    wholesale (AT1.5 snapshot semantics). Audited.
 *   teacherAttendanceForDate / importedDates / summarize — the read side (§8).
 *
 * ✘ resolution (AT1.4): LEAVE iff an APPROVED staff leave covers that staff/date.
 * HR-2 lands the staff-leave SOURCE the first cut lacked (§12). The split is now a
 * READ-TIME OVERLAY (`overlayApprovedLeave`), not a mutation of the stored import:
 * `resolveCrossMark` keeps storing the raw ✘ → ABSENT, and the read side flips it to
 * LEAVE when an approved leave covers it. Read-time is the one correct point because
 * a leave may be approved AFTER the biometric snapshot is imported (a re-upload
 * replaces the date wholesale, AT1.5) — querying at import time would miss those.
 */
import { Types } from "mongoose";
import type { TeacherAttendanceStatus } from "@scd/shared";
import { parseEmployeeAttendanceXlsx, type ParsedAttendanceRow } from "../excel";
import { normalizeName, matchName, indexProfilesByName } from "../reconcile";
import { TeacherAttendanceDay, type ITeacherAttendanceDay } from "../models/TeacherAttendanceDay";
import { StaffNameAlias } from "../models/StaffNameAlias";
import { StaffProfile } from "../../foundation/models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";
import { loadApprovedLeaves, staffLeaveCovers } from "../../hr/services/StaffLeaveService";

export class AttendanceImportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AttendanceImportError";
  }
}

export interface PreviewRow {
  name: string;
  shift: string | null;
  /** Resolved status for storable rows; null when skipped (℞ / no symbol). */
  status: TeacherAttendanceStatus | null;
  punchIn: string | null;
  punchOut: string | null;
  staffProfileId: string | null;
  staffName: string | null;
  skipped: boolean;
}

export interface ImportPreview {
  dateKey: string;
  rows: PreviewRow[];
  matched: number;
  unmatched: number;
  skipped: number;
  /** True when this date already has rows — a commit will overwrite them (AT1.5). */
  alreadyImported: boolean;
}

export interface ImportCommit {
  dateKey: string;
  imported: number;
  skipped: number;
  ignored: number;
  replaced: boolean;
}

/** AT1.4 — ✘ legend resolution. The RAW stored value is ABSENT; the LEAVE-vs-ABSENT
 *  split is a read-time overlay against approved staff leave (HR-2, see header). */
function resolveCrossMark(): TeacherAttendanceStatus {
  return "ABSENT";
}

/** HR-2 overlay: flip a raw ABSENT → LEAVE when an approved staff leave covers the
 *  staff member on the date. Mutates the passed rows' status in place. */
function applyLeaveOverlay<T extends { staffProfileId: string; dateKey: string; status: TeacherAttendanceStatus }>(
  rows: T[],
  leaves: Awaited<ReturnType<typeof loadApprovedLeaves>>,
): T[] {
  if (leaves.length === 0) return rows;
  for (const r of rows) {
    if (r.status === "ABSENT" && staffLeaveCovers(leaves, r.staffProfileId, r.dateKey)) {
      r.status = "LEAVE";
    }
  }
  return rows;
}

function statusOf(row: ParsedAttendanceRow): TeacherAttendanceStatus | null {
  switch (row.mark) {
    case "PRESENT":
      return "PRESENT";
    case "LATE":
      return "LATE";
    case "CROSS":
      return resolveCrossMark();
    case "SKIP":
      return null;
  }
}

async function loadMatchIndexes(): Promise<{
  byName: Map<string, string[]>;
  aliases: Map<string, string>;
  nameOf: Map<string, string>;
}> {
  const profiles = await StaffProfile.find({ active: true }).select("name").lean();
  const candidates = profiles.map((p) => ({ id: p._id.toString(), name: p.name }));
  const byName = indexProfilesByName(candidates);
  const aliasRows = await StaffNameAlias.find({}).lean();
  const aliases = new Map(aliasRows.map((a) => [a.aliasNorm, a.staffProfileId.toString()]));
  const nameOf = new Map(candidates.map((c) => [c.id, c.name]));
  return { byName, aliases, nameOf };
}

/** Parse + match the upload — persists nothing (AT1.6 preview step). */
export async function previewImport(fileBase64: string, reference: Date = new Date()): Promise<ImportPreview> {
  const parsed = await parseEmployeeAttendanceXlsx(Buffer.from(fileBase64, "base64"), reference);
  const { byName, aliases, nameOf } = await loadMatchIndexes();

  const rows: PreviewRow[] = parsed.rows.map((row) => {
    const status = statusOf(row);
    const match = matchName(normalizeName(row.name), byName, aliases);
    const staffProfileId = match.kind === "matched" ? match.staffProfileId : null;
    return {
      name: row.name,
      shift: row.shift ?? null,
      status,
      punchIn: row.punchIn ?? null,
      punchOut: row.punchOut ?? null,
      staffProfileId,
      staffName: staffProfileId ? (nameOf.get(staffProfileId) ?? null) : null,
      skipped: status === null,
    };
  });

  const storable = rows.filter((r) => !r.skipped);
  const alreadyImported =
    (await TeacherAttendanceDay.countDocuments({ dateKey: parsed.dateKey })) > 0;

  return {
    dateKey: parsed.dateKey,
    rows,
    matched: storable.filter((r) => r.staffProfileId).length,
    unmatched: storable.filter((r) => !r.staffProfileId).length,
    skipped: rows.length - storable.length,
    alreadyImported,
  };
}

export interface AliasMapping {
  name: string;
  staffProfileId: string;
}

/**
 * Commit the snapshot. `mappings` become remembered StaffNameAlias rows first
 * (future uploads auto-match, AT1.2); `ignoreNames` explicitly drops rows (e.g.
 * a leaver not in StaffProfile) — anything still unmatched aborts the commit.
 * Same-date rows are replaced wholesale (AT1.5).
 */
export async function commitImport(
  fileBase64: string,
  mappings: AliasMapping[],
  ignoreNames: string[],
  actorId: string,
  reference: Date = new Date(),
): Promise<ImportCommit> {
  const parsed = await parseEmployeeAttendanceXlsx(Buffer.from(fileBase64, "base64"), reference);

  // Remember the Admin's mappings before matching (idempotent upsert by aliasNorm).
  for (const m of mappings) {
    const aliasNorm = normalizeName(m.name);
    const staff = await StaffProfile.findById(m.staffProfileId).lean();
    if (!staff) throw new AttendanceImportError(`Mapping target staff profile not found: ${m.name}`);
    await StaffNameAlias.updateOne(
      { aliasNorm },
      {
        $set: { alias: m.name.trim(), staffProfileId: new Types.ObjectId(m.staffProfileId) },
        $setOnInsert: { createdBy: new Types.ObjectId(actorId) },
      },
      { upsert: true },
    );
  }

  const { byName, aliases } = await loadMatchIndexes();
  const ignored = new Set(ignoreNames.map(normalizeName));

  const docs: Array<Partial<ITeacherAttendanceDay>> = [];
  const unresolved: string[] = [];
  let skipped = 0;
  let ignoredCount = 0;

  for (const row of parsed.rows) {
    const status = statusOf(row);
    if (status === null) {
      skipped++;
      continue;
    }
    const norm = normalizeName(row.name);
    if (ignored.has(norm)) {
      ignoredCount++;
      continue;
    }
    const match = matchName(norm, byName, aliases);
    if (match.kind !== "matched") {
      unresolved.push(row.name);
      continue;
    }
    docs.push({
      staffProfileId: new Types.ObjectId(match.staffProfileId),
      dateKey: parsed.dateKey,
      status,
      punchIn: row.punchIn,
      punchOut: row.punchOut,
      shift: row.shift,
      importedBy: new Types.ObjectId(actorId),
    });
  }

  if (unresolved.length > 0) {
    throw new AttendanceImportError(
      `Unmatched names — map or explicitly ignore them first: ${unresolved.join(", ")}`,
    );
  }

  // Guard the once-per-staff-per-day index against a sheet listing a name twice.
  const seen = new Set<string>();
  const deduped = docs.filter((d) => {
    const key = d.staffProfileId!.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Snapshot semantics (AT1.5): replace the date wholesale.
  const existing = await TeacherAttendanceDay.countDocuments({ dateKey: parsed.dateKey });
  await TeacherAttendanceDay.deleteMany({ dateKey: parsed.dateKey });
  await TeacherAttendanceDay.insertMany(deduped);

  await writeAudit({
    eventKind: "ATTENDANCE_IMPORTED",
    actorId,
    targetKind: "TeacherAttendanceDay",
    meta: {
      dateKey: parsed.dateKey,
      imported: deduped.length,
      skipped,
      ignored: ignoredCount,
      replaced: existing > 0,
    },
  });

  return {
    dateKey: parsed.dateKey,
    imported: deduped.length,
    skipped,
    ignored: ignoredCount,
    replaced: existing > 0,
  };
}

export interface TeacherDayRecord {
  id: string;
  staffProfileId: string;
  staffName: string;
  category: string;
  dateKey: string;
  status: TeacherAttendanceStatus;
  punchIn: string | null;
  punchOut: string | null;
  shift: string | null;
}

/** The daily staff roster for a date (§8), joined with profile name/category. */
export async function teacherAttendanceForDate(dateKey: string): Promise<TeacherDayRecord[]> {
  const rows = await TeacherAttendanceDay.find({ dateKey }).lean();
  if (rows.length === 0) return [];
  const staff = await StaffProfile.find({ _id: { $in: rows.map((r) => r.staffProfileId) } })
    .select("name category")
    .lean();
  const byId = new Map(staff.map((s) => [s._id.toString(), s]));
  const records = rows.map((r) => {
    const profile = byId.get(r.staffProfileId.toString());
    return {
      id: r._id.toString(),
      staffProfileId: r.staffProfileId.toString(),
      staffName: profile?.name ?? "(unknown)",
      category: profile?.category ?? "",
      dateKey: r.dateKey,
      status: r.status,
      punchIn: r.punchIn ?? null,
      punchOut: r.punchOut ?? null,
      shift: r.shift ?? null,
    };
  });
  // HR-2: overlay approved staff leave so ✘=ABSENT shows as LEAVE (the AT1.4 split).
  const leaves = await loadApprovedLeaves(records.map((r) => r.staffProfileId), dateKey, dateKey);
  applyLeaveOverlay(records, leaves);
  return records.sort((a, b) => a.staffName.localeCompare(b.staffName));
}

export interface ImportedDate {
  dateKey: string;
  records: number;
}

/** The imported dates, newest first (AT1.6 past-uploads list). */
export async function importedDates(limit = 60): Promise<ImportedDate[]> {
  const grouped = await TeacherAttendanceDay.aggregate<{ _id: string; records: number }>([
    { $group: { _id: "$dateKey", records: { $sum: 1 } } },
    { $sort: { _id: -1 } },
    { $limit: limit },
  ]);
  return grouped.map((g) => ({ dateKey: g._id, records: g.records }));
}

export interface StaffAttendanceSummary {
  staffProfileId: string;
  staffName: string;
  category: string;
  days: number;
  present: number;
  late: number;
  leave: number;
  absent: number;
  /** present+late over recorded days, 0–100 (a late teacher still attended). */
  presentPct: number;
}

/** Pure roll-up of per-day statuses (unit-tested directly). */
export function summarizeStatuses(statuses: TeacherAttendanceStatus[]): Omit<
  StaffAttendanceSummary,
  "staffProfileId" | "staffName" | "category"
> {
  const count = (s: TeacherAttendanceStatus) => statuses.filter((x) => x === s).length;
  const present = count("PRESENT");
  const late = count("LATE");
  const days = statuses.length;
  return {
    days,
    present,
    late,
    leave: count("LEAVE"),
    absent: count("ABSENT"),
    presentPct: days === 0 ? 0 : Math.round(((present + late) / days) * 100),
  };
}

/** Per-staff absence/late/leave counts + % over a period (§8 / O4). */
export async function teacherAttendanceSummary(
  fromKey: string,
  toKey: string,
): Promise<StaffAttendanceSummary[]> {
  const rows = await TeacherAttendanceDay.find({ dateKey: { $gte: fromKey, $lte: toKey } })
    .select("staffProfileId status dateKey")
    .lean();
  // HR-2: overlay approved leave per (staff, date) BEFORE rolling up, so the leave
  // count reflects the ✘=ABSENT → LEAVE split (the AT1.4 seam).
  const flat = rows.map((r) => ({
    staffProfileId: r.staffProfileId.toString(),
    dateKey: r.dateKey,
    status: r.status,
  }));
  const leaves = await loadApprovedLeaves(
    [...new Set(flat.map((r) => r.staffProfileId))],
    fromKey,
    toKey,
  );
  applyLeaveOverlay(flat, leaves);
  const byStaff = new Map<string, TeacherAttendanceStatus[]>();
  for (const r of flat) {
    const list = byStaff.get(r.staffProfileId);
    if (list) list.push(r.status);
    else byStaff.set(r.staffProfileId, [r.status]);
  }
  const staff = await StaffProfile.find({ _id: { $in: [...byStaff.keys()] } })
    .select("name category")
    .lean();
  const profileById = new Map(staff.map((s) => [s._id.toString(), s]));
  return [...byStaff.entries()]
    .map(([staffProfileId, statuses]) => {
      const profile = profileById.get(staffProfileId);
      return {
        staffProfileId,
        staffName: profile?.name ?? "(unknown)",
        category: profile?.category ?? "",
        ...summarizeStatuses(statuses),
      };
    })
    .sort((a, b) => a.staffName.localeCompare(b.staffName));
}
