/**
 * AS-4 — check & follow-up (D-#988/#991, docs/prd-activity-sheets.md).
 *
 *   alert      a return notifies each linked guardian (ACTIVITY_SHEET_CHECKED): result,
 *              sticker or sticker owed; never twice for one return
 *   level-up   `levelUpAfter` সব ঠিক at a level → the next level that suits the class; none
 *              when no harder level suits; the alert carries it
 *   answers    a guardian sees the answer page only after the sheet came back; rendered once
 *              and shared by the sheets on that page; the file gate follows the child
 *   not back   out longer than the rule → NOT_RETURNED, the copy LOST; younger stays out
 *   stickers   owed list: a class teacher's own sections; ticking moves owed → given
 *   today      open / latest checked / owed / done this month
 *
 * In-memory MongoDB, real services, real pdf-lib; Drive, pdftotext and the renderer stubbed.
 */
import { GuardianFeatureAccess } from "../modules/guardian-access/models/GuardianFeatureAccess";
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
const mockRender = jest.fn(async (_pdf: Buffer, page: number) => Buffer.from(`jpg-${page}`));
jest.mock("../modules/activity-sheets/services/pdfTools", () => {
  const actual = jest.requireActual("../modules/activity-sheets/services/pdfTools");
  return {
    ...actual,
    // Answer PDF: page 1 holds E-001 + E-002, page 2 holds M-001.
    pdfPageTexts: async () => ["SD-E-001 SD-E-002", "SD-M-001"],
    renderPage: (pdf: Buffer, page: number) => mockRender(pdf, page),
  };
});

import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { Notification } from "../modules/notifications/models/Notification";
import { ActivityBank } from "../modules/activity-sheets/models/ActivityBank";
import { ActivitySheet } from "../modules/activity-sheets/models/ActivitySheet";
import { ActivityCopy } from "../modules/activity-sheets/models/ActivityCopy";
import { ActivityIssue } from "../modules/activity-sheets/models/ActivityIssue";
import { ActivitySettings } from "../modules/activity-sheets/models/ActivitySettings";
import { assertActivityFileReadAccess, clearActivityFileCache, importBank, updateBank } from "../modules/activity-sheets/services/ActivityBankService";
import { saveActivityRules } from "../modules/activity-sheets/services/ActivitySettingsService";
import { deskReturn, deskTake, printStock } from "../modules/activity-sheets/services/ActivityCornerService";
import {
  FOLLOW_ERRORS_BN,
  activityToday,
  answerImage,
  giveOwedStickers,
  levelUpHints,
  stickersOwed,
  sweepNotReturned,
} from "../modules/activity-sheets/services/ActivityFollowUpService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // D-#1011: the guardian paths are tested with both features switched on for everyone.
  await GuardianFeatureAccess.create([{ feature: "STORYBOOKS", onForAll: true }, { feature: "ACTIVITY_SHEETS", onForAll: true }]);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const MODELS = [Class, Section, Student, Guardian, GuardianLink, StoredFile, Notification, ActivityBank, ActivitySheet, ActivityCopy, ActivityIssue, ActivitySettings];
beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  clearActivityFileCache();
  mockRender.mockClear();
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

/** SD: E suits KG–Class 1 (3 sheets), M suits Class 1–2 (2), H Class 3 (1); with answers. */
async function bank() {
  const head = "Item ID,Bank,Level,Classes,Details,Page in bank PDF,Given to (student),Date";
  const rows = [
    "SD-E-001,SD,E,KG – Class 1,x,2,,",
    "SD-E-002,SD,E,KG – Class 1,x,3,,",
    "SD-E-003,SD,E,KG – Class 1,x,4,,",
    "SD-M-001,SD,M,Class 1 – 2,x,5,,",
    "SD-M-002,SD,M,Class 1 – 2,x,6,,",
    "SD-H-001,SD,H,Class 3,x,7,,",
  ];
  const r = await importBank({ actorId: officeId, nameBn: "পার্থক্য খোঁজো", skillArea: "THINKING", csvText: [head, ...rows].join("\n"), sheetPdf: await pdf(7), answerPdf: await pdf(2) });
  await updateBank(r.bank._id.toString(), { status: "PUBLISHED" }, officeId);
  return r.bank;
}

async function family(level: number, name: string, classTeacherId?: string) {
  seq += 1;
  const c = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  const s = await Section.collection.insertOne({ classId: c.insertedId, nameBn: `শাখা ${seq}`, code: "A", active: true, ...(classTeacherId ? { classTeacherId: new Types.ObjectId(classTeacherId) } : {}) });
  const kid = await Student.collection.insertOne({ schoolId: `0${100 + seq}`, name, nameBn: `${name} বাংলা`, classId: c.insertedId, sectionId: s.insertedId, active: true });
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid.insertedId, relation: "mother", active: true });
  return { ctx: ctxOf(g.insertedId.toString(), "GUARDIAN"), kid: kid.insertedId.toString() };
}

/** Tray copies for every sheet (1 each), in item order: serial n = the n-th sheet E1,E2,E3,M1,M2,H1. */
async function stock() {
  await printStock([], officeId, { sheets: 5, copies: 1 });
}
async function serialOf(itemId: string): Promise<string> {
  const sheet = await ActivitySheet.findOne({ itemId }).lean();
  const copy = await ActivityCopy.findOne({ sheetId: sheet!._id, status: "IN_TRAY" }).lean();
  return String(copy!.serial);
}
async function doSheet(kid: string, itemId: string, result: string, viaBox = false) {
  const code = await serialOf(itemId);
  await deskTake(code, kid, officeId);
  return deskReturn({ code, result, viaBox }, officeId);
}

describe("checked alert + level-up", () => {
  it("notifies the family once per return, with sticker / owed and the level-up hint", async () => {
    await bank();
    await stock();
    const c1 = await family(1, "Hamza");
    await saveActivityRules({ levelUpAfter: 2 }, officeId);
    await doSheet(c1.kid, "SD-E-001", "ALL_CORRECT");
    let n = await Notification.find({ kind: "ACTIVITY_SHEET_CHECKED" }).lean();
    expect(n).toHaveLength(1);
    expect(n[0].titleBn).toBe("Hamza বাংলা একটি অ্যাক্টিভিটি শিট শেষ করেছে ★");
    expect(n[0].bodyBn).toMatch(/^পার্থক্য খোঁজো \(সহজ\) — সব ঠিক। স্টিকার পেয়েছে। অ্যাপে উত্তর দেখে নিন।$/);
    expect(await levelUpHints(c1.kid)).toEqual([]);
    await doSheet(c1.kid, "SD-E-002", "ALL_CORRECT");
    n = await Notification.find({ kind: "ACTIVITY_SHEET_CHECKED" }).sort({ createdAt: 1 }).lean();
    expect(n[1].bodyBn).toContain("এবার মাঝারি স্তর চেষ্টা করতে পারে।");
    expect((await levelUpHints(c1.kid)).map((h) => [h.from, h.to])).toEqual([["E", "M"]]);
    await doSheet(c1.kid, "SD-E-003", "INCOMPLETE", true);
    n = await Notification.find({ kind: "ACTIVITY_SHEET_CHECKED" }).sort({ createdAt: 1 }).lean();
    expect(n[2].titleBn).toBe("Hamza বাংলা-এর অ্যাক্টিভিটি শিট দেখা হয়েছে");
    expect(n[2].bodyBn).toContain("অসম্পূর্ণ");
  });

  it("gives no hint when no harder level suits the class", async () => {
    await bank();
    await stock();
    const kg = await family(0, "Aisha");
    await saveActivityRules({ levelUpAfter: 2 }, officeId);
    await doSheet(kg.kid, "SD-E-001", "ALL_CORRECT");
    await doSheet(kg.kid, "SD-E-002", "ALL_CORRECT");
    expect(await levelUpHints(kg.kid)).toEqual([]);
  });
});

describe("answer page", () => {
  it("opens for the guardian only after return, rendered once per answer page", async () => {
    await bank();
    await stock();
    const kg = await family(0, "Aisha");
    const other = await family(0, "Zara");
    mockRender.mockClear(); // the import rendered the sample pages
    const code = await serialOf("SD-E-001");
    const issue = await deskTake(code, kg.kid, officeId);
    await expect(answerImage(kg.ctx, issue._id.toString())).rejects.toThrow(FOLLOW_ERRORS_BN.notBack);
    await deskReturn({ code, result: "SOME_MISTAKES" }, officeId);
    expect(await answerImage(kg.ctx, issue._id.toString())).toBe(`data:image/jpeg;base64,${Buffer.from("jpg-1").toString("base64")}`);
    await expect(answerImage(other.ctx, issue._id.toString())).rejects.toThrow(/অনুমতি নেই/);
    // E-002 shares answer page 1: no second render.
    const sheets = await ActivitySheet.find({ itemId: { $in: ["SD-E-001", "SD-E-002", "SD-M-001"] } }).sort({ itemId: 1 }).lean();
    expect(sheets[0].answerImageId?.toString()).toBe(sheets[1].answerImageId?.toString());
    expect(sheets[2].answerImageId).toBeUndefined();
    expect(mockRender).toHaveBeenCalledTimes(1);
    // The file gate: this family yes, another no, staff yes.
    const file = { _id: sheets[0].answerImageId!, kind: "activity_page" };
    await expect(assertActivityFileReadAccess(kg.ctx, file)).resolves.toBeUndefined();
    await expect(assertActivityFileReadAccess(other.ctx, file)).rejects.toThrow(/অনুমতি নেই/);
    await expect(assertActivityFileReadAccess(ctxOf(new Types.ObjectId().toString(), "TEACHER"), file)).resolves.toBeUndefined();
  });
});

describe("not returned, stickers owed, today", () => {
  it("closes sheets out too long and drops their copies", async () => {
    await bank();
    await stock();
    const kg = await family(0, "Aisha");
    const old = await deskTake(await serialOf("SD-E-001"), kg.kid, officeId, new Date("2026-10-01T04:00:00Z"));
    const fresh = await deskTake(await serialOf("SD-E-002"), kg.kid, officeId, new Date("2026-10-10T04:00:00Z"));
    expect(await sweepNotReturned(new Date("2026-10-20T04:00:00Z"))).toBe(1);
    expect((await ActivityIssue.findById(old._id).lean())!.status).toBe("NOT_RETURNED");
    expect((await ActivityIssue.findById(fresh._id).lean())!.status).toBe("HANDED");
    expect((await ActivityCopy.findById(old.copyId).lean())!.status).toBe("LOST");
    expect(await sweepNotReturned(new Date("2026-10-20T04:00:00Z"))).toBe(0);
  });

  it("lists owed stickers by class teacher and ticks them off; the Today card counts", async () => {
    await bank();
    await stock();
    const teacher = new Types.ObjectId().toString();
    const mine = await family(0, "Aisha", teacher);
    const theirs = await family(1, "Hamza");
    await doSheet(mine.kid, "SD-E-001", "ALL_CORRECT", true);
    await doSheet(theirs.kid, "SD-E-002", "SOME_MISTAKES", true);
    const ct = ctxOf(teacher, "TEACHER");
    const list = await stickersOwed(ct);
    expect(list.map((r) => r.studentName)).toEqual(["Aisha বাংলা"]);
    expect(await stickersOwed(office)).toHaveLength(2);
    let today = await activityToday(mine.kid);
    expect(today).toMatchObject({ open: 0, owed: 1, doneThisMonth: 1, latest: { bankNameBn: "পার্থক্য খোঁজো", itemId: "SD-E-001" } });
    const all = (await stickersOwed(office)).map((r) => r.issue._id.toString());
    expect(await giveOwedStickers(ct, all)).toBe(1);
    today = await activityToday(mine.kid);
    expect(today.owed).toBe(0);
    expect((await ActivityIssue.findOne({ studentId: new Types.ObjectId(mine.kid) }).lean())!.stickerGiven).toBe(true);
  });
});
