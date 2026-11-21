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
  /** Values (phone / email / address / nid / bank / pay / password) still real after `--apply`; must be 0. */
  residue: Record<string, number>;
  residueTotal: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

class Masker {
  private phoneMap = new Map<string, string>();
  private emailMap = new Map<string, string>();
  private usedPhones = new Set<string>();
  private usedEmails = new Set<string>();
  private nextPhone = 1;
  private nextEmail = 1;

  /** Reserve values already in the fake shape so a new number never collides with one. */
  reserve(value: string): void {
    if (FAKE_PHONE_RE.test(value)) this.usedPhones.add(value);
    if (FAKE_EMAIL_RE.test(value)) this.usedEmails.add(value);
  }

  phone(orig: string): string {
    if (FAKE_PHONE_RE.test(orig)) return orig;
    const hit = this.phoneMap.get(orig);
    if (hit) return hit;
    let v: string;
    do v = `01000${String(this.nextPhone++).padStart(6, "0")}`;
    while (this.usedPhones.has(v));
    this.usedPhones.add(v);
    this.phoneMap.set(orig, v);
    return v;
  }

  email(orig: string): string {
    const key = orig.toLowerCase();
    if (FAKE_EMAIL_RE.test(key)) return key;
    const hit = this.emailMap.get(key);
    if (hit) return hit;
    let v: string;
    do v = `user-${this.nextEmail++}@dev.invalid`;
    while (this.usedEmails.has(v));
    this.usedEmails.add(v);
    this.emailMap.set(key, v);
    return v;
  }
}

const col = (model: string) => mongoose.model(model).collection;

/** Fields cleared (read from the models: Student.address; StaffProfile NID / addresses / bank / pay). */
const STUDENT_CLEAR = ["address"] as const;
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
  const mk = new Masker();
  for (const d of [...uDocs, ...gDocs, ...sDocs, ...stDocs]) {
    mk.reserve(str(d.phone));
    mk.reserve(str(d.whatsapp));
    mk.reserve(str(d.email).toLowerCase());
    mk.reserve(str(d.identifier));
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
      if (Object.keys($set).length) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set } } });
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
      if (Object.keys($set).length) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set } } });
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
