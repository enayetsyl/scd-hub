/**
 * Mask a freshly copied prod database (AL-2, prd-academic-loop-2027 section 9.2 steps 3 + 7).
 *
 * Dev only: refuses unless the DB name ends in `_dev`, outgoing is closed and the target is not prod.
 *   - wipes the old dev operational / mastery-seed collections (WIPE_MODELS) and `@mastery.test` users;
 *   - phones -> `01000` + a 6-digit running number (11 digits, unique); emails -> `user-<n>@dev.invalid`;
 *     `Guardian.identifier` follows its phone / email (a `school_id` identifier is not personal and stays);
 *   - `Student.address` and StaffProfile NID / addresses / bank / pay fields are cleared;
 *   - every `passwordHash` becomes ONE bcrypt hash of `DEV_TEST_PASSWORD` (never logged);
 *   - ends with a residue count that must be 0.
 * The same real phone / email maps to the same fake value in every collection (User.phone is the join key to
 * StaffProfile), values that already match the fake pattern are kept (re-running is safe) and never reused,
 * and numbers are handed out in `_id` order, so the result is deterministic and no unique index can collide.
 * Names stay.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { assertDevTarget, DevGuardError, type GuardInput } from "./guards";
import { WIPE_MODELS, resolveCollections } from "./collections";

export const FAKE_PHONE_RE = /^01000\d{6}$/;
export const FAKE_EMAIL_RE = /^user-\d+@dev\.invalid$/;
const MASTERY_TEST_EMAIL_RE = /@mastery\.test$/i;

type RawDoc = Record<string, unknown>;
type Ops = Array<Record<string, unknown>>;

export interface MaskOptions {
  apply: boolean;
  guard?: GuardInput;
  /** Defaults to `process.env.DEV_TEST_PASSWORD`. */
  password?: string;
  /** Test knob (bcrypt cost). */
  bcryptRounds?: number;
  log?: (line: string) => void;
}

export interface MaskReport {
  applied: boolean;
  wiped: Record<string, number>;
  skippedFutureModels: string[];
  masteryTestUsersRemoved: number;
  masked: Record<string, number>;
  /** Documents the RAW gate changed (a real phone / email found in a field the schema pass does not know). */
  rawMasked: Record<string, number>;
  /** Values (phone / email / address / nid / bank / pay / password) still real after `--apply`; must be 0. */
  residue: Record<string, number>;
  residueTotal: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Real value shapes the RAW gate hunts for in every string of every document (any depth, any field). */
const RAW_PHONE_RE = /(?:\+?88)?01[3-9]\d{8}/g;
const RAW_EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

const stripCc = (p: string): string => p.replace(/^\+?88(?=01)/, "");

/**
 * Deterministic fake values: the fake for a real value is derived from a hash of that value, so a second run
 * (even after a first run that died midway) gives the same fake for the same real value in every collection
 * and the User.phone <-> StaffProfile.phone login join keeps agreeing. Only a clash between two values of the
 * SAME run is resolved (by probing, in sorted order of the real values).
 */
class Masker {
  private phoneMap = new Map<string, string>();
  private emailMap = new Map<string, string>();
  private phoneTaken = new Set<string>();
  private emailTaken = new Set<string>();
  constructor(private readonly key: string) {}

  private digest(kind: string, value: string): number {
    const h = createHash("sha256").update(`${this.key}|${kind}|${value}`).digest();
    return h.readUInt32BE(0);
  }

  phone(orig: string): string {
    const norm = stripCc(orig);
    if (FAKE_PHONE_RE.test(norm)) return norm;
    const hit = this.phoneMap.get(norm);
    if (hit) return hit;
    let n = this.digest("phone", norm) % 1_000_000;
    let v = `01000${String(n).padStart(6, "0")}`;
    while (this.phoneTaken.has(v)) {
      n = (n + 1) % 1_000_000;
      v = `01000${String(n).padStart(6, "0")}`;
    }
    this.phoneTaken.add(v);
    this.phoneMap.set(norm, v);
    return v;
  }

  email(orig: string): string {
    const key = orig.trim().toLowerCase();
    if (FAKE_EMAIL_RE.test(key)) return key;
    const hit = this.emailMap.get(key);
    if (hit) return hit;
    let n = this.digest("email", key) % 10_000_000_000;
    let v = `user-${n}@dev.invalid`;
    while (this.emailTaken.has(v)) {
      n = (n + 1) % 10_000_000_000;
      v = `user-${n}@dev.invalid`;
    }
    this.emailTaken.add(v);
    this.emailMap.set(key, v);
    return v;
  }
}

/** Rewrite every string in `v` (recursively): real emails and BD phones become fakes. Returns [new value, changed?]. */
function rawClean(v: unknown, mk: Masker): [unknown, boolean] {
  if (typeof v === "string") {
    let out = v.replace(RAW_EMAIL_RE, (m) => (FAKE_EMAIL_RE.test(m.toLowerCase()) ? m : mk.email(m)));
    out = out.replace(RAW_PHONE_RE, (m) => mk.phone(m));
    return [out, out !== v];
  }
  if (Array.isArray(v)) {
    let ch = false;
    const arr = v.map((x) => {
      const [nv, c] = rawClean(x, mk);
      if (c) ch = true;
      return nv;
    });
    return [ch ? arr : v, ch];
  }
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    let ch = false;
    const o: RawDoc = {};
    for (const [k, x] of Object.entries(v as RawDoc)) {
      const [nv, c] = rawClean(x, mk);
      if (c) ch = true;
      o[k] = nv;
    }
    return [ch ? o : v, ch];
  }
  return [v, false];
}

/** Count strings in `v` that still hold a real (non-fake) phone or email. */
function rawLeft(v: unknown): number {
  if (typeof v === "string") {
    const e = (v.match(RAW_EMAIL_RE) ?? []).filter((m) => !FAKE_EMAIL_RE.test(m.toLowerCase())).length;
    return e + (v.match(RAW_PHONE_RE) ?? []).length;
  }
  if (Array.isArray(v)) return v.reduce<number>((a, x) => a + rawLeft(x), 0);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.values(v as RawDoc).reduce<number>((a, x) => a + rawLeft(x), 0);
  }
  return 0;
}

const col = (model: string) => mongoose.model(model).collection;

/** Fields cleared (read from the models: Student.address; StaffProfile NID / addresses / bank / pay). */
const STUDENT_CLEAR = ["address", "dob", "biometricId"] as const;
/** Cleared on every identity collection when present (a date of birth / biometric id is never needed on dev). */
const EVERYWHERE_CLEAR = ["dob", "biometricId"] as const;
const STAFF_CLEAR = [
  "nid",
  "presentAddress",
  "permanentAddress",
  "bankAccount",
  "bankAccountName",
  "bankName",
  "bankBranch",
  "routingNo",
  "monthlySalary",
  "paymentMethod",
  // Staff family names are not needed for testing and are personal data (lead, AL-2 review); the staff
  // member's own name stays (the owner wants the real roster on dev).
  "fatherName",
  "motherName",
  "spouseName",
  "dob",
  "biometricId",
] as const;

const byId = (docs: RawDoc[]): RawDoc[] => docs.sort((a, b) => String(a._id).localeCompare(String(b._id)));

async function writeBatches(model: string, ops: Ops): Promise<void> {
  const c = col(model);
  for (let i = 0; i < ops.length; i += 1000) {
    await c.bulkWrite(ops.slice(i, i + 1000) as never, { ordered: true });
  }
}

function updateOf($set: RawDoc, $unset: RawDoc): RawDoc {
  const update: RawDoc = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  return update;
}

export async function runMask(opts: MaskOptions): Promise<MaskReport> {
  const log = opts.log ?? (() => undefined);
  assertDevTarget(opts.guard);
  const password = opts.password ?? process.env.DEV_TEST_PASSWORD;
  if (opts.apply && !password) {
    throw new DevGuardError("refused: DEV_TEST_PASSWORD is not set (the shared dev password is read from the environment)");
  }

  const wipeSet = resolveCollections(WIPE_MODELS);
  const report: MaskReport = {
    applied: opts.apply,
    wiped: {},
    skippedFutureModels: wipeSet.skipped,
    masteryTestUsersRemoved: 0,
    masked: {},
    rawMasked: {},
    residue: {},
    residueTotal: 0,
  };

  // --- 1. wipe (section 9.2 step 3) ---------------------------------------
  for (const w of wipeSet.found) {
    const c = col(w.model);
    report.wiped[w.collection] = await c.countDocuments({});
    if (opts.apply) await c.deleteMany({});
  }
  const users = col("User");
  report.masteryTestUsersRemoved = await users.countDocuments({ email: { $regex: MASTERY_TEST_EMAIL_RE } });
  if (opts.apply) await users.deleteMany({ email: { $regex: MASTERY_TEST_EMAIL_RE } });

  // --- 2. mask -------------------------------------------------------------
  const guardians = col("Guardian");
  const staff = col("StaffProfile");
  const students = col("Student");
  const [uDocs, gDocs, sDocs, stDocs] = (await Promise.all([
    users.find({}).toArray(),
    guardians.find({}).toArray(),
    staff.find({}).toArray(),
    students.find({}).toArray(),
  ])) as unknown as RawDoc[][];
  const mk = new Masker(password ?? "dev-mask");
  // Assign fakes up front, in sorted order of the real values, so a clash inside one run is resolved the same way every time.
  {
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const d of [...uDocs, ...gDocs, ...sDocs, ...stDocs]) {
      for (const k of ["phone", "whatsapp"]) if (str(d[k])) phones.add(stripCc(str(d[k])));
      if (str(d.email)) emails.add(str(d.email).toLowerCase());
      if (str(d.identifierKind) === "phone" && str(d.identifier)) phones.add(stripCc(str(d.identifier)));
      if (str(d.identifierKind) === "email" && str(d.identifier)) emails.add(str(d.identifier).toLowerCase());
    }
    for (const p of [...phones].sort()) mk.phone(p);
    for (const e of [...emails].sort()) mk.email(e);
  }

  const hash = opts.apply ? await bcrypt.hash(password as string, opts.bcryptRounds ?? 10) : "";
  const plan: Array<{ model: string; ops: Ops }> = [];
  const add = (model: string, ops: Ops): void => {
    plan.push({ model, ops });
    report.masked[model] = ops.length;
  };

  {
    const ops: Ops = [];
    for (const d of byId(uDocs)) {
      const $set: RawDoc = {};
      if (str(d.phone)) $set.phone = mk.phone(str(d.phone));
      if (str(d.email)) $set.email = mk.email(str(d.email));
      if (d.passwordHash !== undefined && d.passwordHash !== null) $set.passwordHash = hash;
      const $unset: RawDoc = {};
      for (const f of EVERYWHERE_CLEAR) if (d[f] !== undefined) $unset[f] = "";
      const update = updateOf($set, $unset);
      if (Object.keys(update).length) ops.push({ updateOne: { filter: { _id: d._id }, update } });
    }
    add("User", ops);
  }
  {
    const ops: Ops = [];
    for (const d of byId(gDocs)) {
      const $set: RawDoc = {};
      if (str(d.phone)) $set.phone = mk.phone(str(d.phone));
      if (str(d.email)) $set.email = mk.email(str(d.email));
      const kind = str(d.identifierKind);
      const ident = str(d.identifier);
      if (kind === "phone" && ident) $set.identifier = mk.phone(ident);
      else if (kind === "email" && ident) $set.identifier = mk.email(ident);
      if (d.passwordHash !== undefined && d.passwordHash !== null) $set.passwordHash = hash;
      const $unset: RawDoc = {};
      for (const f of EVERYWHERE_CLEAR) if (d[f] !== undefined) $unset[f] = "";
      const update = updateOf($set, $unset);
      if (Object.keys(update).length) ops.push({ updateOne: { filter: { _id: d._id }, update } });
    }
    add("Guardian", ops);
  }
  {
    const ops: Ops = [];
    for (const d of byId(sDocs)) {
      const $set: RawDoc = {};
      const $unset: RawDoc = {};
      if (str(d.phone)) $set.phone = mk.phone(str(d.phone));
      if (str(d.whatsapp)) $set.whatsapp = mk.phone(str(d.whatsapp));
      if (str(d.email)) $set.email = mk.email(str(d.email));
      for (const f of STAFF_CLEAR) if (d[f] !== undefined) $unset[f] = "";
      const update = updateOf($set, $unset);
      if (Object.keys(update).length) ops.push({ updateOne: { filter: { _id: d._id }, update } });
    }
    add("StaffProfile", ops);
  }
  {
    const ops: Ops = [];
    for (const d of byId(stDocs)) {
      const $set: RawDoc = {};
      const $unset: RawDoc = {};
      if (str(d.phone)) $set.phone = mk.phone(str(d.phone));
      for (const f of STUDENT_CLEAR) if (d[f] !== undefined) $unset[f] = "";
      const update = updateOf($set, $unset);
      if (Object.keys(update).length) ops.push({ updateOne: { filter: { _id: d._id }, update } });
    }
    add("Student", ops);
  }

  if (opts.apply) {
    for (const p of plan) await writeBatches(p.model, p.ops);
  }

  // --- 2b. RAW gate: do not trust the schema. Scan every string of every identity document, at any depth,
  // in any field (including legacy fields no longer in the model) and mask real phones / emails in place.
  const RAW_MODELS = ["User", "Guardian", "StaffProfile", "Student"] as const;
  const rawLeftBefore: Record<string, number> = {};
  for (const m of RAW_MODELS) {
    const docs = (await col(m).find({}).toArray()) as unknown as RawDoc[];
    const ops: Ops = [];
    for (const d of byId(docs)) {
      const $set: RawDoc = {};
      for (const [k, v] of Object.entries(d)) {
        if (k === "_id" || k === "passwordHash") continue;
        const [nv, changed] = rawClean(v, mk);
        if (changed) $set[k] = nv;
      }
      if (Object.keys($set).length) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set } } });
    }
    rawLeftBefore[m] = ops.length;
    report.rawMasked[m] = ops.length;
    if (opts.apply) await writeBatches(m, ops);
  }

  // --- 3. residue count (values that do NOT match the fake patterns) ---------
  if (opts.apply) {
    const nonFake = (field: string, re: RegExp): RawDoc => ({ [field]: { $exists: true, $nin: [null, ""], $not: re } });
    const present = (field: string): RawDoc => ({ [field]: { $exists: true, $nin: [null, ""] } });
    const checks: Array<[string, () => Promise<number>]> = [
      ["users.phone", () => users.countDocuments(nonFake("phone", FAKE_PHONE_RE))],
      ["users.email", () => users.countDocuments(nonFake("email", FAKE_EMAIL_RE))],
      ["users.passwordHash", () => users.countDocuments({ passwordHash: { $exists: true, $ne: hash } })],
      ["guardians.phone", () => guardians.countDocuments(nonFake("phone", FAKE_PHONE_RE))],
      ["guardians.email", () => guardians.countDocuments(nonFake("email", FAKE_EMAIL_RE))],
      [
        "guardians.identifier",
        async () =>
          (await guardians.countDocuments({ identifierKind: "phone", ...nonFake("identifier", FAKE_PHONE_RE) })) +
          (await guardians.countDocuments({ identifierKind: "email", ...nonFake("identifier", FAKE_EMAIL_RE) })),
      ],
      ["guardians.passwordHash", () => guardians.countDocuments({ passwordHash: { $exists: true, $nin: [null, hash] } })],
      ["staffprofiles.phone", () => staff.countDocuments(nonFake("phone", FAKE_PHONE_RE))],
      ["staffprofiles.whatsapp", () => staff.countDocuments(nonFake("whatsapp", FAKE_PHONE_RE))],
      ["staffprofiles.email", () => staff.countDocuments(nonFake("email", FAKE_EMAIL_RE))],
      ...STAFF_CLEAR.map((f): [string, () => Promise<number>] => [`staffprofiles.${f}`, () => staff.countDocuments(present(f))]),
      ["students.phone", () => students.countDocuments(nonFake("phone", FAKE_PHONE_RE))],
      ...STUDENT_CLEAR.map((f): [string, () => Promise<number>] => [`students.${f}`, () => students.countDocuments(present(f))]),
    ];
    const rawDocs = async (m: string): Promise<number> => {
      let n = 0;
      for (const d of (await col(m).find({}).toArray()) as unknown as RawDoc[]) {
        for (const [k, v] of Object.entries(d)) if (k !== "_id" && k !== "passwordHash") n += rawLeft(v);
      }
      return n;
    };
    for (const m of RAW_MODELS) checks.push([`raw.${m}`, () => rawDocs(m)]);
    for (const [m, c] of [["users", users], ["guardians", guardians]] as const) {
      for (const f of EVERYWHERE_CLEAR) checks.push([`${m}.${f}`, () => c.countDocuments(present(f))]);
    }
    for (const [label, fn] of checks) {
      const n = await fn();
      report.residue[label] = n;
      report.residueTotal += n;
    }
  }

  log(
    `[dev-mask] ${opts.apply ? "APPLIED" : "dry run"}: wiped ${Object.values(report.wiped).reduce((a, b) => a + b, 0)} rows, ` +
      `${report.masteryTestUsersRemoved} @mastery.test users, masked ${JSON.stringify(report.masked)}` +
      (opts.apply ? `, residue ${report.residueTotal}` : " (residue check runs with --apply)"),
  );
  return report;
}
