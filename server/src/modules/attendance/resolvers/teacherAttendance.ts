/**
 * Teacher-attendance resolvers (AT-1, D-#63/#67) — the daily biometric Excel
 * snapshot ingest + its read side. All gated `attendance:manage` (Principal/
 * Office): teachers don't see each other's attendance (§11).
 *
 *   previewTeacherAttendanceImport — parse + name-match, nothing persisted (AT1.6)
 *   commitTeacherAttendanceImport  — alias mappings → full match-or-ignore →
 *                                    snapshot overwrite + audit (AT1.2/AT1.5)
 *   teacherAttendanceForDate / teacherAttendanceImports / teacherAttendanceSummary
 *
 * The file travels as base64 (the import seam's {filename, content} pattern —
 * the export is ~30 KB, well inside a GraphQL string).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  previewImport,
  commitImport,
  teacherAttendanceForDate,
  importedDates,
  teacherAttendanceSummary,
  type ImportPreview,
  type PreviewRow,
  type ImportCommit,
  type TeacherDayRecord,
  type ImportedDate,
  type StaffAttendanceSummary,
} from "../services/TeacherAttendanceService";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const PreviewRowRef = builder.objectRef<PreviewRow>("TeacherAttendancePreviewRow");
PreviewRowRef.implement({
  description: "One parsed Excel row: legend status + punches + the name-match result (AT1.2).",
  fields: (t) => ({
    name: t.exposeString("name"),
    shift: t.string({ nullable: true, resolve: (r) => r.shift }),
    status: t.string({ nullable: true, resolve: (r) => r.status }),
    punchIn: t.string({ nullable: true, resolve: (r) => r.punchIn }),
    punchOut: t.string({ nullable: true, resolve: (r) => r.punchOut }),
    staffProfileId: t.string({ nullable: true, resolve: (r) => r.staffProfileId }),
    staffName: t.string({ nullable: true, resolve: (r) => r.staffName }),
    skipped: t.exposeBoolean("skipped"),
  }),
});

const ImportPreviewRef = builder.objectRef<ImportPreview>("TeacherAttendanceImportPreview");
ImportPreviewRef.implement({
  description: "Parse result for an uploaded Employee Attendance Report — nothing persisted yet.",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    rows: t.field({ type: [PreviewRowRef], resolve: (p) => p.rows }),
    matched: t.exposeInt("matched"),
    unmatched: t.exposeInt("unmatched"),
    skipped: t.exposeInt("skipped"),
    alreadyImported: t.exposeBoolean("alreadyImported"),
  }),
});

const ImportCommitRef = builder.objectRef<ImportCommit>("TeacherAttendanceImportResult");
ImportCommitRef.implement({
  description: "Committed snapshot counts (AT1.5 — a re-upload replaces the date wholesale).",
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    imported: t.exposeInt("imported"),
    skipped: t.exposeInt("skipped"),
    ignored: t.exposeInt("ignored"),
    replaced: t.exposeBoolean("replaced"),
  }),
});

const TeacherDayRecordRef = builder.objectRef<TeacherDayRecord>("TeacherAttendanceRecord");
TeacherDayRecordRef.implement({
  description: "One staff member's attendance for one date (daily roster, §8).",
  fields: (t) => ({
    id: t.exposeString("id"),
    staffProfileId: t.exposeString("staffProfileId"),
    staffName: t.exposeString("staffName"),
    category: t.exposeString("category"),
    dateKey: t.exposeString("dateKey"),
    status: t.exposeString("status"),
    punchIn: t.string({ nullable: true, resolve: (r) => r.punchIn }),
    punchOut: t.string({ nullable: true, resolve: (r) => r.punchOut }),
    shift: t.string({ nullable: true, resolve: (r) => r.shift }),
  }),
});

const ImportedDateRef = builder.objectRef<ImportedDate>("TeacherAttendanceImportedDate");
ImportedDateRef.implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    records: t.exposeInt("records"),
  }),
});

const StaffSummaryRef = builder.objectRef<StaffAttendanceSummary>("StaffAttendanceSummary");
StaffSummaryRef.implement({
  description: "Per-staff absence/late/leave counts + present % over a period (§8/O4).",
  fields: (t) => ({
    staffProfileId: t.exposeString("staffProfileId"),
    staffName: t.exposeString("staffName"),
    category: t.exposeString("category"),
    days: t.exposeInt("days"),
    present: t.exposeInt("present"),
    late: t.exposeInt("late"),
    leave: t.exposeInt("leave"),
    absent: t.exposeInt("absent"),
    presentPct: t.exposeInt("presentPct"),
  }),
});

const AliasMappingInput = builder.inputType("StaffAliasMappingInput", {
  description: "Map an export name to a StaffProfile — remembered for future uploads (AT1.2).",
  fields: (t) => ({
    name: t.string({ required: true }),
    staffProfileId: t.string({ required: true }),
  }),
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("previewTeacherAttendanceImport", (t) =>
  t.field({
    type: ImportPreviewRef,
    description:
      "Parse an uploaded Employee Attendance Report (.xlsx, base64) and name-match its rows. " +
      "Persists nothing — the commit step writes (AT1.6). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      fileBase64: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => previewImport(args.fileBase64),
  }),
);

builder.mutationField("commitTeacherAttendanceImport", (t) =>
  t.field({
    type: ImportCommitRef,
    description:
      "Commit the snapshot: alias mappings are remembered (AT1.2), every row must be matched or " +
      "explicitly ignored (no silent drop), and the date's rows are replaced wholesale (AT1.5). " +
      "Audited as ATTENDANCE_IMPORTED. Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      fileBase64: t.arg.string({ required: true }),
      mappings: t.arg({ type: [AliasMappingInput], required: false }),
      ignoreNames: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return commitImport(
        args.fileBase64,
        (args.mappings ?? []).map((m) => ({ name: m.name, staffProfileId: m.staffProfileId })),
        args.ignoreNames ?? [],
        ctx.auth.userId,
      );
    },
  }),
);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

builder.queryField("teacherAttendanceForDate", (t) =>
  t.field({
    type: [TeacherDayRecordRef],
    description: "The imported staff roster for a date (§8). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { dateKey: t.arg.string({ required: true }) },
    resolve: async (_root, args) => teacherAttendanceForDate(args.dateKey),
  }),
);

builder.queryField("teacherAttendanceImports", (t) =>
  t.field({
    type: [ImportedDateRef],
    description: "Imported dates, newest first (AT1.6 past-uploads list). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    resolve: async () => importedDates(),
  }),
);

builder.queryField("teacherAttendanceSummary", (t) =>
  t.field({
    type: [StaffSummaryRef],
    description: "Per-staff attendance counts + % over [fromKey, toKey] (§8/O4). Requires attendance:manage.",
    authScopes: { hasPermission: "attendance:manage" },
    args: {
      fromKey: t.arg.string({ required: true }),
      toKey: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => teacherAttendanceSummary(args.fromKey, args.toKey),
  }),
);
