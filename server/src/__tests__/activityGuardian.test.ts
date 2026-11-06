/**
 * AS-3 — guardian choose, morning batch, hand-out (D-#988/#991, docs/prd-activity-sheets.md).
 *
 *   choices   only published banks + levels suiting the child's class; counts; limits shown;
 *             another family's child refused
 *   request   the next sheet never had; all done → the oldest, flagged repeat; a level not
 *             for the class refused; weekly limit (rolling 7 days); open limit; cancel
 *             only while REQUESTED
 *   batch     PERSONAL copies in class → section → name order; requests → PRINTED; the PDF
 *             has a cover slip per section + one page a sheet; a returned personal copy
 *             closes the request
 *   hand-out  a class teacher sees and hands out only their sections; office sees all
 *
 * In-memory MongoDB, real services, real pdf-lib; Drive, pdftotext and the renderer stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PDFDocument } from "pdf-lib";
import type { AppContext } from "../context";

const driveStore = new Map<string, Buffer>();
let driveSeq = 0;
jest.mock("../modules/platform/services/DriveStore", () => {
  const actual = jest.requireActual("../modules/platform/services/DriveStore");
  return {
    ...actual,
    uploadToDrive: async (i: { data: Buffer }) => {
      driveSeq += 1;
      const id = `drive-${driveSeq}`;
      driveStore.set(id, i.data);
      return id;
    },
    downloadFromDrive: async (id: string) => {
      const b = driveStore.get(id);
      if (!b) throw new Error("missing");
      return b;
    },
  };
});
jest.mock("../modules/activity-sheets/services/pdfTools", () => {
  const actual = jest.requireActual("../modules/activity-sheets/services/pdfTools");
  return { ...actual, pdfPageTexts: async () => [], renderPage: async () => Buffer.from("jpg") };
});

import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ActivityBank } from "../modules/activity-sheets/models/ActivityBank";
import { ActivitySheet } from "../modules/activity-sheets/models/ActivitySheet";
import { ActivityCopy, copyCode } from "../modules/activity-sheets/models/ActivityCopy";
import { ActivityIssue } from "../modules/activity-sheets/models/ActivityIssue";
import { ActivitySettings } from "../modules/activity-sheets/models/ActivitySettings";
import { clearActivityFileCache, importBank, updateBank } from "../modules/activity-sheets/services/ActivityBankService";
import { saveActivityRules } from "../modules/activity-sheets/services/ActivitySettingsService";
import { deskReturn } from "../modules/activity-sheets/services/ActivityCornerService";
import {
  GUARDIAN_ERRORS_BN,
  activityChoices,
  batchPdf,
  cancelRequest,
  childSheets,
  handOut,
  handOutRoster,
  pendingRequests,
  printBatch,
  requestSheet,
} from "../modules/activity-sheets/services/ActivityGuardianService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const MODELS = [Class, Section, Student, Guardian, GuardianLink, StoredFile, ActivityBank, ActivitySheet, ActivityCopy, ActivityIssue, ActivitySettings];
beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  clearActivityFileCache();
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
const office = ctxOf(new Types.ObjectId().toString(), "OFFICE");
const officeId = office.auth!.userId;
let seq = 0;

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 280]);
  return Buffer.from(await d.save());
}

/** A bank: E suits KG + Class 1, M Class 1–2, H Class 3; 2 sheets a level. */
async function bank(code = "SD", publish = true) {
  const head = "Item ID,Bank,Level,Classes,Details,Page in bank PDF,Given to (student),Date";
  const rows: string[] = [];
  let page = 2;
  for (const [l, cls] of [["E", "KG – Class 1"], ["M", "Class 1 – 2"], ["H", "Class 3"]]) for (let n = 1; n <= 2; n++) rows.push(`${code}-${l}-00${n},Bank ${code},${l},${cls},x,${page++},,`);
  const r = await importBank({ actorId: officeId, nameBn: `ব্যাংক ${code}`, skillArea: "THINKING", csvText: [head, ...rows].join("\n"), sheetPdf: await pdf(7) });
  if (publish) await updateBank(r.bank._id.toString(), { status: "PUBLISHED" }, officeId);
  return r.bank;
}

async function family(level: number, name: string, sectionCode = "A", classTeacherId?: string) {
  seq += 1;
  const c = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, nameBn: `শাখা ${sectionCode}`, code: sectionCode, active: true, ...(classTeacherId ? { classTeacherId: new Types.ObjectId(classTeacherId) } : {}) });
  const kid = await Student.collection.insertOne({ schoolId: `S-${seq}`, name, nameBn: `${name} বাংলা`, classId: c.insertedId, sectionId: s.insertedId, active: true });
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid.insertedId, relation: "mother", active: true });
  return { ctx: ctxOf(g.insertedId.toString(), "GUARDIAN"), kid: kid.insertedId.toString(), sectionId: s.insertedId.toString() };
}

describe("choose + request", () => {
  it("offers only banks and levels suiting the child's class", async () => {
    const sd = await bank("SD");
    await bank("CO", false); // draft — not offered
    const kg = await family(0, "Aisha");
    const v = await activityChoices(kg.kid);
    expect(v.banks.map((b) => [b.bank.code, b.levels.map((l) => [l.level, l.sheetCount, l.doneByChild])])).toEqual([["SD", [["E", 2, 0]]]]);
    expect(v).toMatchObject({ weeklyLimit: 3, usedThisWeek: 0, maxOpen: 3, open: 0 });
    const c1 = await family(1, "Hamza");
    expect((await activityChoices(c1.kid)).banks[0].levels.map((l) => l.level)).toEqual(["E", "M"]);
    await expect(requestSheet(kg.ctx, kg.kid, sd._id.toString(), "M")).rejects.toThrow(GUARDIAN_ERRORS_BN.notSuited);
    await expect(requestSheet(kg.ctx, c1.kid, sd._id.toString(), "E")).rejects.toThrow(/অনুমতি নেই/);
  });

  it("gives the next sheet never had, then repeats the oldest; limits; cancel", async () => {
    const sd = await bank("SD");
    const kg = await family(0, "Aisha");
    const t0 = new Date("2026-11-01T04:00:00Z");
    const a = await requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", t0);
    const b = await requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", new Date(t0.getTime() + 1000));
    const c = await requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", new Date(t0.getTime() + 2000));
    const items = async (ids: Types.ObjectId[]) => (await ActivitySheet.find({ _id: { $in: ids } }).lean()).map((s) => s.itemId).sort();
    expect(await items([a.sheetId, b.sheetId])).toEqual(["SD-E-001", "SD-E-002"]);
    expect(c.repeat).toBe(true);
    expect((await ActivitySheet.findById(c.sheetId).lean())!.itemId).toBe("SD-E-001"); // the oldest
    await expect(requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", new Date(t0.getTime() + 3000))).rejects.toThrow("এই সপ্তাহে 3টি");
    // A week later the weekly count is clear, but 3 are open.
    const later = new Date(t0.getTime() + 8 * 86400000);
    await expect(requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", later)).rejects.toThrow("হাতে আগেই 3টি");
    await cancelRequest(kg.ctx, c._id.toString());
    await expect(requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E", later)).resolves.toMatchObject({ status: "REQUESTED" });
    await printBatch(null, officeId);
    await expect(cancelRequest(kg.ctx, a._id.toString())).rejects.toThrow(GUARDIAN_ERRORS_BN.notRequested);
  });
});

describe("morning batch + hand-out", () => {
  it("prints named copies with a cover per section, and returns close the request", async () => {
    const sd = await bank("SD");
    const teacher = new Types.ObjectId().toString();
    const kgA = await family(0, "Zara", "A", teacher);
    const kgB = await family(0, "Adam", "B");
    const c1 = await family(1, "Hamza", "A");
    await requestSheet(c1.ctx, c1.kid, sd._id.toString(), "M");
    await requestSheet(kgA.ctx, kgA.kid, sd._id.toString(), "E");
    await requestSheet(kgB.ctx, kgB.kid, sd._id.toString(), "E");
    expect((await pendingRequests()).map((r) => r.studentName)).toEqual(["Zara বাংলা", "Adam বাংলা", "Hamza বাংলা"]);
    const run = await printBatch(null, officeId, new Date("2026-11-06T02:00:00Z"));
    expect(run.sheets).toBe(3);
    expect(await ActivityIssue.countDocuments({ status: "PRINTED", printRunId: run.runId })).toBe(3);
    expect(await ActivityCopy.countDocuments({ kind: "PERSONAL", status: "TAKEN" })).toBe(3);
    // 3 sections → 3 cover slips + 3 pages.
    expect((await PDFDocument.load(await batchPdf(run.runId))).getPageCount()).toBe(6);
    await expect(printBatch(null, officeId)).rejects.toThrow(GUARDIAN_ERRORS_BN.nothing);

    // The class teacher of KG A sees only Zara; the office sees all three.
    const ct = ctxOf(teacher, "TEACHER");
    expect((await handOutRoster(ct)).map((r) => r.studentName)).toEqual(["Zara বাংলা"]);
    expect(await handOutRoster(office)).toHaveLength(3);
    const all = (await handOutRoster(office)).map((r) => r.issue._id.toString());
    expect(await handOut(ct, all)).toBe(1); // only her own
    expect(await handOut(office, all)).toBe(2);

    // The guardian's list, and a return through the desk closes it.
    const zara = await childSheets(kgA.kid);
    expect(zara[0]).toMatchObject({ issue: { status: "HANDED", path: "GUARDIAN" }, sheet: { itemId: "SD-E-001" } });
    const copy = await ActivityCopy.findById(zara[0].issue.copyId).lean();
    const back = await deskReturn({ code: copyCode(copy!.serial), result: "ALL_CORRECT" }, officeId);
    expect(back).toMatchObject({ status: "RETURNED", stickerGiven: true, path: "GUARDIAN" });
    expect((await activityChoices(kgA.kid)).banks[0].levels[0].doneByChild).toBe(1);
  });

  it("a returned personal copy that was never tapped as handed still closes", async () => {
    const sd = await bank("SD");
    const kg = await family(0, "Aisha");
    await saveActivityRules({ weeklyRequests: 5 }, officeId);
    await requestSheet(kg.ctx, kg.kid, sd._id.toString(), "E");
    await printBatch(null, officeId);
    const issue = await ActivityIssue.findOne({ status: "PRINTED" }).lean();
    const copy = await ActivityCopy.findById(issue!.copyId).lean();
    const back = await deskReturn({ code: copyCode(copy!.serial), result: "SOME_MISTAKES", viaBox: true }, officeId);
    expect(back).toMatchObject({ status: "RETURNED", stickerOwed: true });
    expect(back.handedAt).toBeTruthy();
  });
});
