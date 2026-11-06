/**
 * D-#1030–#1034 — exam paper bank (docs/prd-exam-paper-bank.md).
 *
 *   reference   upload → PROCESSING → READY with pages + the original kept; Office reads
 *               pages; a teacher is refused; /files gate covers page + source; hash lookup;
 *               edit + delete drop rows and Drive files
 *   import      a valid draft imports once (re-import refused); a bad one lists problems;
 *               only exam_papers:manage imports
 *   reviewer    assigning sets IN_REVIEW and notifies the reviewer ONCE for several papers;
 *               the reviewer sees only their papers; another teacher is refused
 *   review      confirm / un-confirm an item; confirm a whole section; suggest EDIT / DELETE /
 *               ADD (each validated); withdraw own; submit → REVIEWED
 *   resolve     accepting EDIT keeps history and clears the confirmation; DELETE marks
 *               removed; ADD inserts a REVIEWER item after the anchor; reject leaves the paper;
 *               FINAL blocks further review
 *   drafts      every committed draft file passes the server validator
 *
 * In-memory MongoDB, real services; Drive and pdftoppm stubbed.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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
    deleteFromDrive: async (id: string) => {
      driveStore.delete(id);
    },
  };
});

const mockRender = jest.fn();
jest.mock("../modules/class-books/services/pdfPages", () => {
  const actual = jest.requireActual("../modules/class-books/services/pdfPages");
  return { ...actual, renderPdfPages: (pdf: Buffer) => mockRender(pdf) };
});

import { User } from "../modules/foundation/models/User";
import { StoredFile } from "../modules/platform/models/StoredFile";
import { Notification } from "../modules/notifications/models/Notification";
import { ReferencePaper } from "../modules/exam-papers/models/ReferencePaper";
import { ExamPaperDraft } from "../modules/exam-papers/models/ExamPaperDraft";
import { ExamPaperSuggestion } from "../modules/exam-papers/models/ExamPaperSuggestion";
import {
  assertReferencePaperFileReadAccess,
  clearReferencePageCache,
  deleteReferencePaper,
  referencePaperByHash,
  referencePaperPage,
  referencePapers,
  sourceHashOf,
  startReferencePaperUpload,
  updateReferencePaper,
  validateReferenceUpload,
} from "../modules/exam-papers/services/ReferencePaperService";
import {
  assignExamPaperReviewer,
  confirmExamSectionSyllabus,
  examPaperDraft,
  examPaperDrafts,
  finalizeExamPaper,
  importExamPaperDraft,
  resolveExamPaperSuggestion,
  setExamItemSyllabusMatch,
  submitExamPaperReview,
  suggestExamPaperChange,
  validateDraftPayload,
  withdrawExamPaperSuggestion,
} from "../modules/exam-papers/services/ExamPaperDraftService";

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

beforeEach(async () => {
  await Promise.all(
    [User, StoredFile, Notification, ReferencePaper, ExamPaperDraft, ExamPaperSuggestion].map((m) =>
      (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
  driveStore.clear();
  mockRender.mockReset();
  clearReferencePageCache();
});

function fakeJpeg(w: number, h: number, tag: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, tag]);
}

const ctxOf = (userId: string, role: string): AppContext => ({ auth: { userId, role } } as unknown as AppContext);

async function staff(role: "TEACHER" | "OFFICE" | "PRINCIPAL", name: string): Promise<AppContext> {
  const u = await User.create({ role, name, email: `${name.toLowerCase()}@t.test`, active: true, passwordHash: "x" });
  return ctxOf(String(u._id), role);
}

function draft(key = "annual-2026-L3-BAN") {
  return {
    schema: "scd.exam-paper-draft/v1",
    key,
    exam: { term: "ANNUAL", year: 2026, nameBn: "বার্ষিক পরীক্ষা ২০২৬" },
    classLevel: 3,
    subject: "BAN",
    titleBn: "বার্ষিক পরীক্ষা ২০২৬ · তৃতীয় শ্রেণি · বাংলা",
    fullMarks: 10,
    syllabusRows: [
      { seq: 1, label: "সঠিক উত্তর", itemType: "mcq", component: null, count: 2, marksEach: 2, total: 4 },
      { seq: 2, label: "শূন্যস্থান", itemType: "fill_blank", component: null, count: 3, marksEach: 2, total: 6 },
    ],
    sections: [
      {
        seq: 1, syllabusRowSeq: 1, kind: "WRITTEN", instructionBn: "সঠিক উত্তর বেছে নাও", count: 2, marksEach: 2, total: 4,
        items: [
          { key: "s1-1", text: "প্রশ্ন ১", options: ["ক", "খ", "গ", "ঘ"], answer: "ক", source: "MP2026", sourceRef: "মোহাম্মদপুর ২০২৬ · ১(ক)" },
          { key: "s1-2", text: "প্রশ্ন ২", options: ["ক", "খ", "গ", "ঘ"], answer: "খ", source: "NEW" },
        ],
      },
      {
        seq: 2, syllabusRowSeq: 2, kind: "WRITTEN", instructionBn: "শূন্যস্থান পূরণ কর", count: 3, marksEach: 2, total: 6,
        items: [
          { key: "s2-1", text: "___ ১", answer: "a", source: "MP2026_ADAPTED", sourceRef: "মোহাম্মদপুর ২০২৬ · ৩" },
          { key: "s2-2", text: "___ ২", answer: "b", source: "NEW" },
          { key: "s2-3", text: "___ ৩", answer: "c", source: "NEW" },
        ],
      },
    ],
  };
}

describe("reference papers", () => {
  test("upload renders pages, keeps the original, Office reads, teacher refused, delete cleans up", async () => {
    const office = await staff("OFFICE", "Office");
    const teacher = await staff("TEACHER", "Teach");
    mockRender.mockResolvedValue([fakeJpeg(1000, 1414, 1), fakeJpeg(1000, 1414, 2)]);
    const docx = Buffer.from("docx-bytes");
    const { paper, done } = await startReferencePaperUpload({
      actorId: office.auth!.userId, term: "ANNUAL", year: 2026, classLevel: 3, subject: "ban", title: "তৃতীয় শ্রেণি · বাংলা",
      pdf: Buffer.from("%PDF"), pdfName: "c3.pdf",
      source: { data: docx, name: "c3.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    });
    expect(paper.status).toBe("PROCESSING");
    expect(paper.subject).toBe("BAN");
    await done;
    const [row] = await referencePapers({ year: 2026 });
    expect(row.status).toBe("READY");
    expect(row.pageCount).toBe(2);
    expect(row.sourceName).toBe("c3.docx");
    expect(row.classLabelBn).toBeTruthy();
    expect((await StoredFile.find({ kind: "reference_paper_page" })).length).toBe(2);

    const p2 = await referencePaperPage(office, row.id, 2);
    expect(p2.dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    await expect(referencePaperPage(teacher, row.id, 1)).rejects.toThrow();
    await expect(referencePaperPage(office, row.id, 3)).rejects.toThrow();

    await expect(assertReferencePaperFileReadAccess(office, row.sourceFileId!)).resolves.toBeUndefined();
    await expect(assertReferencePaperFileReadAccess(teacher, row.sourceFileId!)).rejects.toThrow();
    await expect(assertReferencePaperFileReadAccess(office, new Types.ObjectId().toString())).rejects.toThrow();
    expect((await referencePaperByHash(sourceHashOf(docx)))?.id).toBe(row.id);

    const edited = await updateReferencePaper(office.auth!.userId, row.id, { term: "HALF_YEARLY", clearClass: true });
    expect(edited.term).toBe("HALF_YEARLY");
    expect(edited.classLevel).toBeNull();

    await deleteReferencePaper(office.auth!.userId, row.id);
    expect(await ReferencePaper.countDocuments()).toBe(0);
    expect(await StoredFile.countDocuments()).toBe(0);
    expect(driveStore.size).toBe(0);
  });

  test("validation: pdf required, source must be pdf/docx, render failure → FAILED", async () => {
    expect(validateReferenceUpload("image/png", 10)).toBeTruthy();
    expect(validateReferenceUpload("application/pdf", 10, "image/png", 10)).toBeTruthy();
    expect(validateReferenceUpload("application/pdf", 10)).toBeNull();
    const office = await staff("OFFICE", "Office");
    await expect(
      startReferencePaperUpload({ actorId: office.auth!.userId, term: "WHENEVER", year: 2026, subject: "BAN", title: "x", pdf: Buffer.from("x"), pdfName: "x.pdf" }),
    ).rejects.toThrow();
    mockRender.mockRejectedValue(new Error("bad pdf"));
    const { done } = await startReferencePaperUpload({ actorId: office.auth!.userId, term: "ANNUAL", year: 2025, subject: "BAN", title: "x", pdf: Buffer.from("x"), pdfName: "x.pdf" });
    await done;
    const [row] = await referencePapers({});
    expect(row.status).toBe("FAILED");
    expect(row.error).toBeTruthy();
  });
});

describe("draft papers", () => {
  test("import: manager only, once per key, bad payload refused", async () => {
    const principal = await staff("PRINCIPAL", "Principal");
    const office = await staff("OFFICE", "Office");
    await expect(importExamPaperDraft(office, draft())).rejects.toThrow();
    const s = await importExamPaperDraft(principal, draft());
    expect(s.status).toBe("DRAFT");
    expect(s.itemCount).toBe(5);
    await expect(importExamPaperDraft(principal, draft())).rejects.toThrow();
    const bad = { ...draft("k2"), fullMarks: 11 };
    expect(validateDraftPayload(bad).join(" ")).toMatch(/sum/);
    await expect(importExamPaperDraft(principal, bad)).rejects.toThrow();
  });

  test("reviewer flow: assign, see own only, confirm, suggest, resolve, submit, final", async () => {
    const principal = await staff("PRINCIPAL", "Principal");
    const office = await staff("OFFICE", "Office");
    const fida = await staff("TEACHER", "Fida");
    const other = await staff("TEACHER", "Other");
    const a = await importExamPaperDraft(principal, draft("a"));
    const b = await importExamPaperDraft(principal, draft("b"));

    // Not assigned yet → the teacher sees nothing and cannot open it.
    expect(await examPaperDrafts(fida)).toHaveLength(0);
    await expect(examPaperDraft(fida, a.id)).rejects.toThrow();

    await expect(assignExamPaperReviewer(office, [a.id], fida.auth!.userId)).rejects.toThrow();
    const assigned = await assignExamPaperReviewer(principal, [a.id, b.id], fida.auth!.userId);
    expect(assigned.every((p) => p.status === "IN_REVIEW" && p.reviewerName === "Fida")).toBe(true);
    const notes = await Notification.find({ recipientUserId: fida.auth!.userId });
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("REVIEW_ASSIGNED");
    expect(notes[0].refs?.examPaperId).toBe("list");

    expect(await examPaperDrafts(fida)).toHaveLength(2);
    expect(await examPaperDrafts(other)).toHaveLength(0);
    expect(await examPaperDrafts(office)).toHaveLength(2);
    await expect(examPaperDraft(other, a.id)).rejects.toThrow();
    await expect(setExamItemSyllabusMatch(other, a.id, "s1-1", true)).rejects.toThrow();
    await expect(setExamItemSyllabusMatch(office, a.id, "s1-1", true)).rejects.toThrow();

    let d = await setExamItemSyllabusMatch(fida, a.id, "s1-1", true);
    expect(d.viewerIsReviewer).toBe(true);
    expect(d.sections[0].items[0].syllabusConfirmed).toBe(true);
    expect(d.sections[0].items[0].syllabusConfirmedByName).toBe("Fida");
    d = await setExamItemSyllabusMatch(fida, a.id, "s1-1", false);
    expect(d.confirmedCount).toBe(0);
    d = await confirmExamSectionSyllabus(fida, a.id, 2);
    expect(d.confirmedCount).toBe(3);

    await expect(suggestExamPaperChange(fida, { paperId: a.id, kind: "EDIT", sectionSeq: 1, itemKey: "s1-1" })).rejects.toThrow();
    await expect(suggestExamPaperChange(fida, { paperId: a.id, kind: "DELETE", sectionSeq: 1, itemKey: "s1-2" })).rejects.toThrow();
    await expect(suggestExamPaperChange(fida, { paperId: a.id, kind: "ADD", sectionSeq: 9, proposedText: "x" })).rejects.toThrow();
    d = await suggestExamPaperChange(fida, { paperId: a.id, kind: "EDIT", sectionSeq: 1, itemKey: "s2-1", proposedText: "নতুন লেখা", proposedAnswer: "z" });
    d = await suggestExamPaperChange(fida, { paperId: a.id, kind: "DELETE", sectionSeq: 1, itemKey: "s1-2", reason: "সিলেবাসের বাইরে" });
    d = await suggestExamPaperChange(fida, { paperId: a.id, kind: "ADD", sectionSeq: 1, itemKey: "s1-1", proposedText: "নতুন প্রশ্ন", proposedOptions: ["১", "২", "৩", "৪"], proposedAnswer: "২" });
    d = await suggestExamPaperChange(fida, { paperId: a.id, kind: "ADD", sectionSeq: 2, proposedText: "ফিরিয়ে নেব" });
    expect(d.openSuggestions).toBe(4);
    const [edit, del, add, toWithdraw] = d.suggestions;
    expect(edit.sectionSeq).toBe(2); // corrected from the item, not the caller

    await expect(withdrawExamPaperSuggestion(principal, toWithdraw.id)).rejects.toThrow();
    d = await withdrawExamPaperSuggestion(fida, toWithdraw.id);
    expect(d.openSuggestions).toBe(3);

    await expect(resolveExamPaperSuggestion(fida, edit.id, { accept: true })).rejects.toThrow();
    d = await resolveExamPaperSuggestion(principal, edit.id, { accept: true });
    const s21 = d.sections[1].items.find((i) => i.key === "s2-1")!;
    expect(s21.text).toBe("নতুন লেখা");
    expect(s21.answer).toBe("z");
    expect(s21.editedCount).toBe(1);
    expect(s21.syllabusConfirmed).toBe(false);
    const stored = await ExamPaperDraft.findById(a.id).lean();
    expect(stored!.sections[1].items[0].history[0].text).toBe("___ ১");

    d = await resolveExamPaperSuggestion(principal, del.id, { accept: true });
    expect(d.sections[0].items.find((i) => i.key === "s1-2")!.removed).toBe(true);
    expect(d.itemCount).toBe(4);

    d = await resolveExamPaperSuggestion(principal, add.id, { accept: true, text: "নতুন প্রশ্ন (ঠিক করা)" });
    expect(d.sections[0].items.map((i) => i.key)).toEqual(["s1-1", "s1-r1", "s1-2"]);
    expect(d.sections[0].items[1].source).toBe("REVIEWER");
    expect(d.sections[0].items[1].text).toBe("নতুন প্রশ্ন (ঠিক করা)");
    await expect(resolveExamPaperSuggestion(principal, add.id, { accept: false })).rejects.toThrow();

    d = await suggestExamPaperChange(fida, { paperId: a.id, kind: "DELETE", sectionSeq: 2, itemKey: "s2-3", reason: "না" });
    const rejectMe = d.suggestions.find((s) => s.status === "OPEN")!;
    d = await resolveExamPaperSuggestion(principal, rejectMe.id, { accept: false, note: "থাকুক" });
    expect(d.sections[1].items.find((i) => i.key === "s2-3")!.removed).toBe(false);
    expect(d.suggestions.find((s) => s.id === rejectMe.id)!.resolutionNote).toBe("থাকুক");

    await expect(submitExamPaperReview(other, a.id)).rejects.toThrow();
    d = await submitExamPaperReview(fida, a.id, "সব ঠিক আছে");
    expect(d.status).toBe("REVIEWED");

    d = await finalizeExamPaper(principal, a.id, true);
    expect(d.status).toBe("FINAL");
    await expect(setExamItemSyllabusMatch(fida, a.id, "s1-1", true)).rejects.toThrow();
    d = await finalizeExamPaper(principal, a.id, false);
    expect(d.status).toBe("IN_REVIEW");
  });

  test("single-paper assignment deep-links to that paper", async () => {
    const principal = await staff("PRINCIPAL", "Principal");
    const fida = await staff("TEACHER", "Fida");
    const a = await importExamPaperDraft(principal, draft("one"));
    await assignExamPaperReviewer(principal, [a.id], fida.auth!.userId);
    const [n] = await Notification.find({ recipientUserId: fida.auth!.userId });
    expect(n.refs?.examPaperId).toBe(a.id);
  });
});

describe("committed draft files", () => {
  test("every server/assets/exam-papers draft passes the server validator", () => {
    const root = path.join(__dirname, "../../assets/exam-papers");
    if (!fs.existsSync(root)) return;
    const files: string[] = [];
    for (const dir of fs.readdirSync(root)) {
      const full = path.join(root, dir);
      if (!fs.statSync(full).isDirectory()) continue;
      for (const f of fs.readdirSync(full)) if (f.endsWith(".json")) files.push(path.join(full, f));
    }
    for (const f of files) {
      const problems = validateDraftPayload(JSON.parse(fs.readFileSync(f, "utf8")));
      expect({ file: path.basename(f), problems }).toEqual({ file: path.basename(f), problems: [] });
    }
  });
});
