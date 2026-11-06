/**
 * AS-1 — activity banks (D-#988/#989, docs/prd-activity-sheets.md).
 *
 *   pure      CSV (quotes, BOM, CRLF); index rows; "Nursery – KG" → class levels; answer pages
 *   import    a combined CSV needs the bank code; one bank's rows → sheets with pages, level →
 *             classes, answer pages found from the answer PDF's text, 2 samples a level; a
 *             second import of the same code refused; an index page past the PDF refused
 *   attach    a CSV-only bank (Sudoku) gets its PDF later → pages 2.. in level order
 *   add       new pages → the next ids per level (one level for all, or one per page)
 *   replace   one-page PDF only; retire / restore; counts
 *   edit      level → classes moves onto every sheet of that level; bad class refused
 *   gate      sample pages: staff; a guardian only for a PUBLISHED bank suiting their child's
 *             class; bank PDFs only to the bank manager
 *   rules     defaults until saved; bounds
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

const mockTexts = jest.fn();
jest.mock("../modules/activity-sheets/services/pdfTools", () => {
  const actual = jest.requireActual("../modules/activity-sheets/services/pdfTools");
  return {
    ...actual,
    pdfPageTexts: (pdf: Buffer) => mockTexts(pdf),
    renderPage: async (_pdf: Buffer, page: number) => Buffer.from(`jpg-${page}`),
  };
});

import { Class } from "../modules/foundation/models/Class";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { ActivityBank } from "../modules/activity-sheets/models/ActivityBank";
import { ActivitySheet } from "../modules/activity-sheets/models/ActivitySheet";
import { ActivitySettings } from "../modules/activity-sheets/models/ActivitySettings";
import {
  ACTIVITY_ERRORS_BN,
  activityImage,
  addSheets,
  answerPagesOf,
  assertActivityFileReadAccess,
  attachBankPdfs,
  bankSheets,
  classLevelsOf,
  clearActivityFileCache,
  importBank,
  listBanks,
  parseCsv,
  parseIndexCsv,
  replaceSheet,
  setSheetActive,
  updateBank,
} from "../modules/activity-sheets/services/ActivityBankService";
import { activityRules, saveActivityRules } from "../modules/activity-sheets/services/ActivitySettingsService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let seq = 0;

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

const MODELS = [Class, Student, Guardian, GuardianLink, StoredFile, ActivityBank, ActivitySheet, ActivitySettings];

beforeEach(async () => {
  await Promise.all(MODELS.map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
  driveStore.clear();
  clearActivityFileCache();
  mockTexts.mockReset();
  mockTexts.mockResolvedValue([]);
});

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);
const office = ctxOf(new Types.ObjectId().toString(), "OFFICE");
const teacher = ctxOf(new Types.ObjectId().toString(), "TEACHER");
const officeId = office.auth!.userId;

async function pdf(pages: number): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 280]);
  return Buffer.from(await d.save());
}

/** The school's combined index CSV shape: two banks, 2 sheets a level each. */
function csv(): string {
  const head = "﻿Item ID,Bank,Level,Classes,Details,Page in bank PDF,Given to (student),Date";
  const rows: string[] = [];
  let page = 2;
  for (const [lvl, cls] of [["E", "Nursery – KG"], ["M", "KG – Class 1"], ["H", "Class 3 – 6"]]) {
    for (let n = 1; n <= 2; n++) rows.push(`SD-${lvl}-00${n},Spot the Difference,${lvl},${cls},"5 changes, a masjid",${page++},,`);
  }
  for (const lvl of ["E", "M", "H"]) rows.push(`SU-${lvl}-001,Sudoku,${lvl},Class 2,4x4,,,`);
  return [head, ...rows].join("\r\n") + "\r\n";
}

async function klass(level: number): Promise<Types.ObjectId> {
  const r = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  return r.insertedId;
}

async function guardianOfLevel(level: number): Promise<AppContext> {
  seq += 1;
  const classId = await klass(level);
  const kid = await Student.collection.insertOne({ schoolId: `S-${seq}`, name: `Kid ${seq}`, classId, sectionId: new Types.ObjectId(), active: true });
  const g = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name: `G${seq}`, phone: `8801900000${seq}`, loginEnabled: true, active: true });
  await GuardianLink.collection.insertOne({ guardianId: g.insertedId, studentId: kid.insertedId, relation: "mother", active: true });
  return ctxOf(g.insertedId.toString(), "GUARDIAN");
}

async function importSD() {
  mockTexts.mockResolvedValue(["SD-E-001  SD-E-002", "SD-M-001\nSD-M-002", "SD-H-001"]);
  return importBank({ actorId: officeId, nameBn: "পার্থক্য খোঁজো", skillArea: "THINKING", bankNo: 8, code: "sd", csvText: csv(), sheetPdf: await pdf(7), answerPdf: await pdf(3) });
}

describe("pure helpers", () => {
  it("reads quoted CSV fields, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
  it("keeps only real sheet rows", () => {
    const rows = parseIndexCsv(csv() + "notes,,,,,,,\n");
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ itemId: "SD-E-001", level: "E", classesText: "Nursery – KG", details: "5 changes, a masjid", page: 2 });
    expect(rows[6]).toMatchObject({ itemId: "SU-E-001", page: null });
  });
  it("turns the Classes text into class levels, capped at Class 5", () => {
    expect(classLevelsOf("Nursery – KG")).toEqual([-1, 0]);
    expect(classLevelsOf("KG – Class 1")).toEqual([0, 1]);
    expect(classLevelsOf("Class 3 – 6")).toEqual([3, 4, 5]);
    expect(classLevelsOf("Class 2")).toEqual([2]);
    expect(classLevelsOf("Nursery")).toEqual([-1]);
    expect(classLevelsOf("")).toEqual([]);
  });
  it("finds each id's answer page", () => {
    const m = answerPagesOf(["SD-E-001 SD-E-002", "SD-E-002 SD-M-001"]);
    expect([...m]).toEqual([["SD-E-001", 1], ["SD-E-002", 1], ["SD-M-001", 2]]);
  });
});

describe("import", () => {
  it("asks which bank when the CSV holds several", async () => {
    await expect(importBank({ actorId: officeId, nameBn: "x", skillArea: "THINKING", csvText: csv() })).rejects.toThrow(/SD, SU/);
    await expect(importBank({ actorId: officeId, nameBn: "x", skillArea: "THINKING", code: "ZZ", csvText: csv() })).rejects.toThrow(ACTIVITY_ERRORS_BN.codeMissing);
    await expect(importBank({ actorId: officeId, nameBn: "x", skillArea: "NOPE", code: "SD", csvText: csv() })).rejects.toThrow(ACTIVITY_ERRORS_BN.badSkill);
  });

  it("makes one bank's sheets with pages, classes, answers and samples", async () => {
    const r = await importSD();
    expect(r).toMatchObject({ sheets: 6, answersFound: 5, warnings: ["1টি শিটের উত্তর উত্তরপত্রে পাওয়া যায়নি"] });
    expect(r.bank).toMatchObject({ code: "SD", bankNo: 8, nameEn: "Spot the Difference", status: "DRAFT", skillArea: "THINKING" });
    expect(r.bank.levelClasses).toEqual({ E: [-1, 0], M: [0, 1], H: [3, 4, 5] });
    expect(r.bank.sampleFileIds.E).toHaveLength(2);
    const sheets = await bankSheets(r.bank._id.toString());
    expect(sheets.map((s) => [s.itemId, s.page, s.answerPage ?? null, s.classLevels])).toEqual([
      ["SD-E-001", 2, 1, [-1, 0]],
      ["SD-E-002", 3, 1, [-1, 0]],
      ["SD-H-001", 6, 3, [3, 4, 5]],
      ["SD-H-002", 7, null, [3, 4, 5]],
      ["SD-M-001", 4, 2, [0, 1]],
      ["SD-M-002", 5, 2, [0, 1]],
    ]);
    expect(await StoredFile.countDocuments({ kind: "activity_page" })).toBe(6);
    await expect(importSD()).rejects.toThrow(ACTIVITY_ERRORS_BN.dupBank);
  });

  it("refuses an index page past the end of the PDF", async () => {
    await expect(importBank({ actorId: officeId, nameBn: "x", skillArea: "THINKING", code: "SD", csvText: csv(), sheetPdf: await pdf(4) })).rejects.toThrow(ACTIVITY_ERRORS_BN.badPage);
    expect(await ActivityBank.countDocuments()).toBe(0);
  });

  it("takes a CSV-only bank and its PDF later", async () => {
    const r = await importBank({ actorId: officeId, nameBn: "সুডোকু", skillArea: "MATHS", code: "SU", csvText: csv() });
    expect(r.warnings[0]).toMatch(/PDF নেই/);
    expect((await listBanks())[0]).toMatchObject({ withoutPages: 3, answers: 0 });
    mockTexts.mockResolvedValue(["SU-E-001 SU-M-001", "SU-H-001"]);
    await attachBankPdfs(r.bank._id.toString(), await pdf(4), await pdf(2), officeId);
    const sheets = await bankSheets(r.bank._id.toString());
    expect(sheets.map((s) => [s.itemId, s.page, s.answerPage])).toEqual([
      ["SU-E-001", 2, 1],
      ["SU-H-001", 4, 2],
      ["SU-M-001", 3, 1],
    ]);
    expect((await listBanks())[0]).toMatchObject({ withoutPages: 0, answers: 3 });
  });
});

describe("add, replace, retire, edit", () => {
  it("gives new pages the next ids per level", async () => {
    const { bank } = await importSD();
    const one = await addSheets(bank._id.toString(), await pdf(2), ["E"], ["sea", "farm"], officeId);
    expect(one.map((s) => [s.itemId, s.page, s.details, s.classLevels])).toEqual([
      ["SD-E-003", 1, "sea", [-1, 0]],
      ["SD-E-004", 2, "farm", [-1, 0]],
    ]);
    const mixed = await addSheets(bank._id.toString(), await pdf(3), ["M", "H", "H"], null, officeId);
    expect(mixed.map((s) => s.itemId)).toEqual(["SD-M-003", "SD-H-003", "SD-H-004"]);
    await expect(addSheets(bank._id.toString(), await pdf(1), ["X" as never], null, officeId)).rejects.toThrow(ACTIVITY_ERRORS_BN.badLevel);
    await expect(addSheets("nope", await pdf(1), ["E"], null, officeId)).rejects.toThrow(ACTIVITY_ERRORS_BN.bankNotFound);
  });

  it("replaces one sheet with a one-page PDF and retires / restores", async () => {
    const { bank } = await importSD();
    const [first] = await bankSheets(bank._id.toString());
    await expect(replaceSheet(first._id.toString(), await pdf(2), officeId)).rejects.toThrow(ACTIVITY_ERRORS_BN.onePage);
    const re = await replaceSheet(first._id.toString(), await pdf(1), officeId);
    expect(re.page).toBe(1);
    expect(re.sourceFileId?.toString()).not.toBe(bank.sheetFileId?.toString());
    await setSheetActive(first._id.toString(), false, officeId);
    expect((await listBanks())[0]).toMatchObject({ counts: { E: 1, M: 2, H: 2 }, retired: 1 });
    await setSheetActive(first._id.toString(), true, officeId);
    expect((await listBanks())[0].retired).toBe(0);
  });

  it("moves a level's classes onto its sheets, refuses a bad class, publishes", async () => {
    const { bank } = await importSD();
    await updateBank(bank._id.toString(), { levelClasses: { H: [3, 2, 3] }, status: "PUBLISHED", nameBn: "পার্থক্য" }, officeId);
    const sheets = await bankSheets(bank._id.toString());
    expect(sheets.filter((s) => s.level === "H").every((s) => s.classLevels.join() === "2,3")).toBe(true);
    expect(sheets.filter((s) => s.level === "E").every((s) => s.classLevels.join() === "-1,0")).toBe(true);
    expect((await ActivityBank.findById(bank._id).lean())).toMatchObject({ status: "PUBLISHED", nameBn: "পার্থক্য" });
    await expect(updateBank(bank._id.toString(), { levelClasses: { E: [7] } }, officeId)).rejects.toThrow(ACTIVITY_ERRORS_BN.badLevels);
    await expect(updateBank(bank._id.toString(), { status: "GONE" }, officeId)).rejects.toThrow(ACTIVITY_ERRORS_BN.badStatus);
  });

  it("lists only banks suiting a class when asked", async () => {
    await importSD();
    expect(await listBanks({ classLevels: [2] })).toHaveLength(0);
    expect(await listBanks({ classLevels: [1] })).toHaveLength(1);
    expect(await listBanks({ publishedOnly: true })).toHaveLength(0);
  });
});

describe("file gate", () => {
  it("shows samples to staff and to a guardian whose child's class the published bank suits", async () => {
    const { bank } = await importSD();
    const sample = bank.sampleFileIds.E[0];
    const file = { _id: sample, kind: "activity_page" };
    const kg = await guardianOfLevel(0);
    const c3 = await guardianOfLevel(2);
    await expect(assertActivityFileReadAccess(teacher, file)).resolves.toBeUndefined();
    await expect(assertActivityFileReadAccess(kg, file)).rejects.toThrow(ACTIVITY_ERRORS_BN.forbidden); // still DRAFT
    await updateBank(bank._id.toString(), { status: "PUBLISHED" }, officeId);
    expect(await activityImage(kg, sample.toString())).toBe(`data:image/jpeg;base64,${Buffer.from("jpg-2").toString("base64")}`);
    await expect(activityImage(c3, sample.toString())).rejects.toThrow(ACTIVITY_ERRORS_BN.forbidden);
    // An unknown activity_page (not a sample) is refused for a guardian.
    await expect(assertActivityFileReadAccess(kg, { _id: new Types.ObjectId(), kind: "activity_page" })).rejects.toThrow(ACTIVITY_ERRORS_BN.forbidden);
  });

  it("serves bank PDFs only to the bank manager", async () => {
    const { bank } = await importSD();
    const file = { _id: bank.sheetFileId!, kind: "activity_bank_pdf" };
    await expect(assertActivityFileReadAccess(office, file)).resolves.toBeUndefined();
    await expect(assertActivityFileReadAccess(teacher, file)).rejects.toThrow(ACTIVITY_ERRORS_BN.forbidden);
    await expect(activityImage(office, bank.sheetFileId!.toString())).rejects.toThrow(ACTIVITY_ERRORS_BN.sheetNotFound);
  });
});

describe("rules", () => {
  it("answers the defaults until saved and keeps values in bounds", async () => {
    expect(await activityRules()).toMatchObject({ weeklyRequests: 3, maxOpen: 3, monthlyTarget: 8, busyMode: false, isDefault: true });
    const saved = await saveActivityRules({ weeklyRequests: 5, busyMode: true }, officeId);
    expect(saved).toMatchObject({ weeklyRequests: 5, maxOpen: 3, busyMode: true, isDefault: false });
    await expect(saveActivityRules({ maxOpen: 0 }, officeId)).rejects.toThrow(/1–50/);
  });
});
