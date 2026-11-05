/**
 * AS-2 — the activity corner (D-#988, docs/prd-activity-sheets.md).
 *
 *   trays     published banks only; in-tray / out counts; low when below the rule; printable
 *   restock   no picks = every low tray; the next sheets by rotation (wraps), N copies each,
 *             serials in order; the run's PDF has one stamped page a copy
 *   take      by "AS-000001" or "1"; school ID 103 finds 0103; a repeat is flagged; the open
 *             limit refuses; a copy not in the tray refused; cancel puts it back
 *   return    সব ঠিক → sticker; via the box → sticker owed; অসম্পূর্ণ → no sticker; twice refused;
 *             a never-scanned tray copy needs the child and is marked unscanned
 *   lost      off the counts; the open sheet closes as not returned
 *
 * In-memory MongoDB, real services, real pdf-lib; Drive, pdftotext and the renderer stubbed.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PDFDocument } from "pdf-lib";

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
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ActivityBank } from "../modules/activity-sheets/models/ActivityBank";
import { ActivitySheet } from "../modules/activity-sheets/models/ActivitySheet";
import { ActivityCopy } from "../modules/activity-sheets/models/ActivityCopy";
import { ActivityIssue } from "../modules/activity-sheets/models/ActivityIssue";
import { ActivitySettings } from "../modules/activity-sheets/models/ActivitySettings";
import { clearActivityFileCache, importBank, updateBank } from "../modules/activity-sheets/services/ActivityBankService";
import { saveActivityRules } from "../modules/activity-sheets/services/ActivitySettingsService";
import {
  CORNER_ERRORS_BN,
  cancelTake,
  deskCopy,
  deskReturn,
  deskTake,
  findCornerStudents,
  markCopyLost,
  printRunPdf,
  printStock,
  trayView,
} from "../modules/activity-sheets/services/ActivityCornerService";

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

const MODELS = [Class, Section, Student, StoredFile, ActivityBank, ActivitySheet, ActivityCopy, ActivityIssue, ActivitySettings];
beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  clearActivityFileCache();
});

const officeId = new Types.ObjectId().toString();

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 280]);
  return Buffer.from(await d.save());
}

/** SD with 3 sheets a level (pages 2..10), published. */
async function bank(publish = true) {
  const head = "Item ID,Bank,Level,Classes,Details,Page in bank PDF,Given to (student),Date";
  const rows: string[] = [];
  let page = 2;
  for (const l of ["E", "M", "H"]) for (let n = 1; n <= 3; n++) rows.push(`SD-${l}-00${n},Spot the Difference,${l},KG – Class 1,x,${page++},,`);
  const r = await importBank({ actorId: officeId, nameBn: "পার্থক্য খোঁজো", skillArea: "THINKING", csvText: [head, ...rows].join("\n"), sheetPdf: await pdf(10) });
  if (publish) await updateBank(r.bank._id.toString(), { status: "PUBLISHED" }, officeId);
  return r.bank;
}

async function kid(schoolId: string, name: string) {
  const c = await Class.collection.insertOne({ level: 0, nameBn: "কেজি", academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, nameBn: "ক", name: "A", active: true });
  const r = await Student.collection.insertOne({ schoolId, name, nameBn: `${name} (বাংলা)`, classId: c.insertedId, sectionId: s.insertedId, active: true });
  return r.insertedId.toString();
}

describe("trays + restock", () => {
  it("counts trays, prints the low ones by rotation, and wraps", async () => {
    const b = await bank();
    await bank(false).catch(() => undefined); // same code refused; only one bank
    let v = await trayView();
    expect(v.trays).toHaveLength(1);
    expect(v.trays[0].levels.map((l) => [l.level, l.inTray, l.low, l.printable])).toEqual([
      ["E", 0, true, 3],
      ["M", 0, true, 3],
      ["H", 0, true, 3],
    ]);
    const run = await printStock([], officeId, { sheets: 2, copies: 2 });
    expect(run).toMatchObject({ copies: 12, sheets: 6 });
    const copies = await ActivityCopy.find({ printRunId: run.runId }).sort({ serial: 1 }).lean();
    expect(copies.map((c) => c.serial)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    v = await trayView();
    expect(v.trays[0].levels.map((l) => l.inTray)).toEqual([4, 4, 4]);
    // E rotation was at 2 → the next run takes E-003 then wraps to E-001.
    const run2 = await printStock([{ bankId: b._id.toString(), level: "E" }], officeId, { sheets: 2, copies: 1 });
    const second = await ActivityCopy.find({ printRunId: run2.runId }).sort({ serial: 1 }).lean();
    const ids = await ActivitySheet.find({ _id: { $in: second.map((c) => c.sheetId) } }).lean();
    const itemOf = new Map(ids.map((s) => [s._id.toString(), s.itemId]));
    expect(second.map((c) => itemOf.get(c.sheetId.toString()))).toEqual(["SD-E-003", "SD-E-001"]);
    const out = await PDFDocument.load(await printRunPdf(run.runId));
    expect(out.getPageCount()).toBe(12);
  });

  it("prints nothing for a draft bank", async () => {
    const b = await bank(false);
    await expect(printStock([{ bankId: b._id.toString(), level: "E" }], officeId)).rejects.toThrow(CORNER_ERRORS_BN.nothingToPrint);
  });
});

describe("desk", () => {
  it("takes by code + school ID, flags a repeat, enforces the open limit, cancels", async () => {
    await bank();
    await printStock([], officeId, { sheets: 1, copies: 3 }); // serials 1..3 = E-001 ×3, 4..6 M, 7..9 H
    const aisha = await kid("0103", "Aisha");
    expect((await findCornerStudents("103")).map((s) => s.id)).toEqual([aisha]);
    expect((await findCornerStudents("aish"))[0]).toMatchObject({ name: "Aisha (বাংলা)", classLabelBn: "কেজি", sectionNameBn: "ক", openSheets: 0 });

    const first = await deskTake("AS-000001", aisha, officeId);
    expect(first).toMatchObject({ path: "TRAY", status: "HANDED", repeat: false });
    expect((await deskCopy("1")).holder?.id).toBe(aisha);
    await expect(deskTake("1", aisha, officeId)).rejects.toThrow(CORNER_ERRORS_BN.notInTray);
    const again = await deskTake("2", aisha, officeId); // another copy of the same sheet
    expect(again.repeat).toBe(true);
    await saveActivityRules({ maxOpen: 2 }, officeId);
    await expect(deskTake("4", aisha, officeId)).rejects.toThrow("আগেই 2টি শিট");
    expect((await cancelTake("2", officeId)).status).toBe("IN_TRAY");
    await expect(cancelTake("2", officeId)).rejects.toThrow(CORNER_ERRORS_BN.notTake);
    await expect(deskTake("4", aisha, officeId)).resolves.toMatchObject({ repeat: false });
    await expect(deskTake("x9", aisha, officeId)).rejects.toThrow(CORNER_ERRORS_BN.badCode);
    await expect(deskTake("999", aisha, officeId)).rejects.toThrow(CORNER_ERRORS_BN.copyNotFound);
  });

  it("checks returns: sticker, owed via the box, none when unfinished, never twice", async () => {
    await bank();
    await printStock([], officeId, { sheets: 1, copies: 3 });
    const aisha = await kid("0103", "Aisha");
    await deskTake("1", aisha, officeId);
    await deskTake("4", aisha, officeId);
    await deskTake("7", aisha, officeId);
    await expect(deskReturn({ code: "1", result: "MAYBE" }, officeId)).rejects.toThrow(CORNER_ERRORS_BN.badResult);
    expect(await deskReturn({ code: "1", result: "ALL_CORRECT" }, officeId)).toMatchObject({ status: "RETURNED", stickerGiven: true, stickerOwed: false });
    expect(await deskReturn({ code: "4", result: "SOME_MISTAKES", viaBox: true }, officeId)).toMatchObject({ stickerGiven: false, stickerOwed: true });
    expect(await deskReturn({ code: "7", result: "INCOMPLETE", viaBox: true }, officeId)).toMatchObject({ stickerGiven: false, stickerOwed: false });
    await expect(deskReturn({ code: "1", result: "ALL_CORRECT" }, officeId)).rejects.toThrow(CORNER_ERRORS_BN.alreadyBack);
    expect((await deskCopy("1")).copy.status).toBe("RETURNED");
    expect((await findCornerStudents("103"))[0].openSheets).toBe(0);
  });

  it("records a busy-time take at return, with the child named then", async () => {
    await bank();
    await printStock([], officeId, { sheets: 1, copies: 1 });
    const hamza = await kid("0204", "Hamza");
    await expect(deskReturn({ code: "2", result: "ALL_CORRECT" }, officeId)).rejects.toThrow(CORNER_ERRORS_BN.whoIsIt);
    const r = await deskReturn({ code: "2", result: "ALL_CORRECT", studentId: hamza }, officeId);
    expect(r).toMatchObject({ unscannedTake: true, status: "RETURNED", stickerGiven: true, studentId: new Types.ObjectId(hamza) });
  });

  it("marks a copy lost: off the counts, the open sheet closed", async () => {
    await bank();
    await printStock([], officeId, { sheets: 1, copies: 2 });
    const aisha = await kid("0103", "Aisha");
    await deskTake("1", aisha, officeId);
    await markCopyLost("1", officeId);
    expect(await ActivityIssue.countDocuments({ status: "NOT_RETURNED" })).toBe(1);
    expect((await trayView()).trays[0].levels[0]).toMatchObject({ inTray: 1, out: 0 });
    await expect(deskReturn({ code: "1", result: "ALL_CORRECT" }, officeId)).rejects.toThrow(CORNER_ERRORS_BN.lost);
  });
});
