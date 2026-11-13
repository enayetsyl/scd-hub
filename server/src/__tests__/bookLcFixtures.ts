/**
 * Shared fixtures for the book-lifecycle tests (docs/prd-book-lifecycle.md §19). Not a test file.
 *
 * mongodb-memory-server: the main DB plus a SECOND database opened through `connectBookDb(uri)`
 * for the book plane — never Atlas, never the VM. Drive is an in-memory map (see `driveMock`).
 * Every book text, title and name here is INVENTED (the repo is public; no real book content).
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import PDFDocument from "pdfkit";
import * as path from "path";
import type { Permission } from "@scd/shared";
import type { AuthPayload } from "../context";
import { connectBookDb, disconnectBookDb, bookConnection } from "../bookDb";
import { User } from "../modules/foundation/models/User";

/** In-memory Drive: `jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock)`. */
const driveFiles = new Map<string, Buffer>();
let driveSeq = 0;
export const driveMock = {
  DriveUnavailableError: class DriveUnavailableError extends Error {},
  uploadToDrive: jest.fn(async (input: { data: Buffer }) => {
    const id = `drive-${++driveSeq}`;
    driveFiles.set(id, Buffer.from(input.data));
    return id;
  }),
  downloadFromDrive: jest.fn(async (id: string) => {
    const b = driveFiles.get(id);
    if (!b) throw new Error(`no drive file ${id}`);
    return b;
  }),
  deleteFromDrive: jest.fn(async (id: string) => {
    driveFiles.delete(id);
  }),
  driveQuota: jest.fn(async () => ({ usageBytes: 0, usageInDriveBytes: 0, usageInDriveTrashBytes: 0, limitBytes: null })),
  listFolderByName: jest.fn(async () => []),
  listDriveFolder: jest.fn(async () => []),
};

export interface LcFx {
  mongo: MongoMemoryServer;
  auth: {
    principal: AuthPayload;
    office: AuthPayload;
    officeManage: AuthPayload;
    officeRelease: AuthPayload;
    officeFinalizeGrant: AuthPayload;
    teacher: AuthPayload;
    guardian: AuthPayload;
  };
  ids: Record<string, Types.ObjectId>;
}

const a = (id: Types.ObjectId, role: AuthPayload["role"], grantedPermissions: Permission[] = []): AuthPayload => ({ userId: id.toString(), role, grantedPermissions, revokedPermissions: [], additionalTemplates: [] });

export async function setupLc(): Promise<LcFx> {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("scd_main"));
  await connectBookDb(mongo.getUri("scd_books"));
  await Promise.allSettled(Object.values(mongoose.models).map((m) => m.init()));
  await Promise.allSettled(Object.values(bookConnection.models).map((m) => m.init()));
  const ids = {
    principal: new Types.ObjectId(),
    office: new Types.ObjectId(),
    officeManage: new Types.ObjectId(),
    officeRelease: new Types.ObjectId(),
    officeFinalizeGrant: new Types.ObjectId(),
    teacher: new Types.ObjectId(),
    guardian: new Types.ObjectId(),
  };
  const manage: Permission[] = ["book_lifecycle:view", "book_lifecycle:manage"];
  await User.create([
    { _id: ids.principal, role: "PRINCIPAL", name: "Head Teacher Test", email: "head@school.test", passwordHash: "x", active: true },
    { _id: ids.office, role: "OFFICE", name: "Office Plain", email: "office@school.test", passwordHash: "x", active: true },
    { _id: ids.officeManage, role: "OFFICE", name: "Office Manage", email: "office2@school.test", passwordHash: "x", active: true, grantedPermissions: manage },
    { _id: ids.officeRelease, role: "OFFICE", name: "Office Release", email: "office3@school.test", passwordHash: "x", active: true, grantedPermissions: ["book_lifecycle:view", "book_lifecycle:release"] },
    { _id: ids.officeFinalizeGrant, role: "OFFICE", name: "Office Tries Finalize", email: "office4@school.test", passwordHash: "x", active: true, grantedPermissions: [...manage, "book_lifecycle:finalize"] },
    { _id: ids.teacher, role: "TEACHER", name: "Kalpanik Shikkhok", email: "teacher@school.test", passwordHash: "x", active: true },
    { _id: ids.guardian, role: "GUARDIAN", name: "Guardian Test", email: "g@school.test", passwordHash: "x", active: true },
  ]);
  return {
    mongo,
    ids,
    auth: {
      principal: a(ids.principal, "PRINCIPAL"),
      office: a(ids.office, "OFFICE"),
      officeManage: a(ids.officeManage, "OFFICE", manage),
      officeRelease: a(ids.officeRelease, "OFFICE", ["book_lifecycle:view", "book_lifecycle:release"]),
      officeFinalizeGrant: a(ids.officeFinalizeGrant, "OFFICE", [...manage, "book_lifecycle:finalize"]),
      teacher: a(ids.teacher, "TEACHER"),
      guardian: a(ids.guardian, "GUARDIAN"),
    },
  };
}

export async function teardownLc(fx: LcFx): Promise<void> {
  await disconnectBookDb();
  await mongoose.disconnect();
  await fx.mongo.stop();
}

/** Clear the book plane between tests (users stay). */
export async function resetBooks(): Promise<void> {
  await Promise.all(Object.values(bookConnection.models).map((m) => m.deleteMany({})));
}

// ---------------------------------------------------------------------------
// Invented book text
// ---------------------------------------------------------------------------

/** An invented master: a front part with server regions and a protected block, then chapters. */
export function sampleMaster(opts: { chapters?: number; extra?: string; markers?: boolean; latinTitles?: boolean } = {}): string {
  const n = opts.chapters ?? 3;
  const front = [
    "# খেলার বই — পরীক্ষামূলক",
    "",
    '<!-- bl:server start name="version-line" -->',
    "সংস্করণ ০",
    "<!-- bl:server end -->",
    "",
    '<!-- bl:protect start reason="names" -->',
    "অনুমোদিত নাম: টুনটুনি, ঝুমঝুমি",
    "<!-- bl:protect end -->",
    "",
    '<!-- bl:server start name="version-log" -->',
    "-",
    "<!-- bl:server end -->",
    "",
  ].join("\n");
  const chapters: string[] = [];
  for (let i = 1; i <= n; i++) {
    chapters.push(
      [
        ...(opts.markers ? [`<!-- bl:ch ch-${String(i).padStart(3, "0")} -->`] : []),
        opts.latinTitles ? `## Chapter ${i} River Story` : `## অধ্যায় ${i}: নদীর গল্প ${i}`,
        "",
        `টুনটুনি নদীর ধারে বসে ${i}টি নৌকা গুনল। The river is calm today.`,
        "",
        `### অনুশীলনী ${i}`,
        "",
        `১. নৌকা কয়টি? (${i})`,
        "",
      ].join("\n"),
    );
  }
  return front + chapters.join("") + (opts.extra ?? "");
}

const FONT = path.resolve(__dirname, "../../assets/fonts/NotoSansBengali-Regular.ttf");

/**
 * An invented N-page master PDF made with pdfkit; `chapterPages[i]` is the page (1-based) where
 * chapter i+1 begins, whose title is drawn there as `Chapter <i+1> River Story` (Latin, so
 * pdftotext extraction is exact). Each page carries its printed number "p. <n>".
 */
export async function samplePdf(pages: number, chapterStarts: { title: string; page: number }[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A5", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  doc.on("data", (c: Buffer) => chunks.push(c));
  doc.registerFont("bn", FONT);
  for (let p = 1; p <= pages; p++) {
    if (p > 1) doc.addPage();
    const ch = chapterStarts.find((c) => c.page === p);
    doc.font("Helvetica").fontSize(14).text(ch ? ch.title : `Body text page ${p}`);
    doc.font("Helvetica").fontSize(9).text(`p. ${p}`, 40, doc.page.height - 80, { lineBreak: false });
  }
  doc.end();
  return done;
}

export function fileAuth(x: AuthPayload): AuthPayload {
  return x;
}

// ---------------------------------------------------------------------------
// Flow helpers (services imported lazily so the Drive mock is in place first)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-require-imports */
const svc = () => ({
  version: require("../modules/book-lifecycle/services/versionService") as typeof import("../modules/book-lifecycle/services/versionService"),
  feedback: require("../modules/book-lifecycle/services/feedbackService") as typeof import("../modules/book-lifecycle/services/feedbackService"),
  round: require("../modules/book-lifecycle/services/roundService") as typeof import("../modules/book-lifecycle/services/roundService"),
  store: require("../modules/book-lifecycle/services/store") as typeof import("../modules/book-lifecycle/services/store"),
});

export async function importSample(auth: AuthPayload, opts: { code?: string; state?: "draft" | "approved" | "final" | "print_released"; version?: string; chapters?: number; latinTitles?: boolean; editions?: ("TEACHER" | "STUDENT" | "SCHOLARSHIP_STUDENT")[] } = {}) {
  return svc().version.importBook(auth, {
    code: opts.code ?? "C3-BAN",
    classLevel: 3,
    subject: "BAN",
    titleBn: "পরীক্ষার বই",
    version: opts.version ?? "v7.4",
    state: opts.state ?? "draft",
    editions: opts.editions,
    masterMd: Buffer.from(sampleMaster({ chapters: opts.chapters ?? 3, latinTitles: opts.latinTitles })),
  });
}

/** File + triage an item; returns it. */
export async function item(auth: AuthPayload, bookId: string, route: "needs_reviewer" | "direct_fix" | "verbal_errata", extra: Partial<{ category: string; chapterKey: string; quote: string; textBn: string; source: "school" | "print_error" | "proof_read" }> = {}) {
  const s = svc();
  const f = await s.feedback.fileFeedback(auth, bookId, extra.source ?? "school", {
    category: (extra.category ?? "spelling") as never,
    textBn: extra.textBn ?? "একটি বানান ঠিক করুন",
    chapterKey: extra.chapterKey ?? "ch-001",
    quote: extra.quote,
  });
  const [t] = await s.feedback.triageFeedback(auth, [f._id.toString()], { kind: "route", route });
  return t;
}

/** Upload a child of the latest version replacing `from` → `to` in one chapter, citing `refs`. */
export async function childVersion(auth: AuthPayload, bookId: string, from: string, to: string, refs: string[], opts: { bump?: "minor" | "major" } = {}) {
  const s = svc();
  const book = await s.store.loadBook(bookId);
  const latest = await s.store.loadVersion(book.latestVersionId!);
  const master = await s.store.storedMaster(latest);
  if (!master.includes(from)) throw new Error(`fixture: '${from}' not in master`);
  const draft = await s.version.uploadNewVersionDraft(auth, bookId, { masterMd: Buffer.from(master.replace(from, to)) });
  const changed = draft.chapters.filter((c) => c.status === "edited");
  await s.version.setDraftChanges(auth, draft._id.toString(), changed.map((c) => ({ chapterKey: c.key, beforeExcerpt: from, afterExcerpt: to, reason: "পরীক্ষা", refs })));
  for (const c of changed) await s.version.decideDraftChapter(auth, draft._id.toString(), c.key, true);
  return s.version.acceptDraft(auth, draft._id.toString(), { summaryBn: `${from} → ${to}`, bump: opts.bump });
}

/** Upload a fresh master PDF for the version (pages × chapter starts known). */
export async function attachMasterPdf(auth: AuthPayload, versionId: string, pages = 12, starts?: { title: string; page: number }[]) {
  const s = svc();
  const v = await s.store.loadVersion(versionId);
  const titles = v.chapters.filter((c) => c.key !== "front").sort((a, b) => a.order - b.order);
  const st = starts ?? titles.map((c, i) => ({ title: c.title, page: 3 + i * 3 }));
  return s.version.uploadVersionFile(auth, versionId, { role: "master_pdf", name: "master.pdf", data: await samplePdf(pages, st), mime: "application/pdf" });
}

/** Open a round on the latest version and take it to `sent_on_paper` (hand page map). */
export async function roundSent(auth: AuthPayload, bookId: string, opts: { scope?: "whole" | "changed"; reviewerName?: string; selfReview?: boolean } = {}) {
  const s = svc();
  const book = await s.store.loadBook(bookId);
  const v = await s.store.loadVersion(book.latestVersionId!);
  await attachMasterPdf(auth, v._id.toString());
  let r = await s.round.openRound(auth, bookId, { reviewerName: opts.reviewerName ?? "পর্যালোচক আপা (কাল্পনিক)", selfReview: opts.selfReview });
  r = await s.round.detectPageMap(auth, r._id.toString());
  const chapters = v.chapters.filter((c) => c.key !== "front").sort((a, b) => a.order - b.order);
  r = await s.round.setPageMap(auth, r._id.toString(), chapters.map((c, i) => ({ chapterKey: c.key, startPage: 3 + i * 3 })));
  r = await s.round.makePacket(auth, r._id.toString(), opts.scope ?? "whole");
  r = await s.round.markSentOnPaper(auth, r._id.toString(), { sentAt: new Date("2026-11-10T04:00:00Z") });
  return r;
}

/** Record an "approved" return with every asked row marked agree / first option and checked. */
export async function approveOnPaper(auth: AuthPayload, roundId: string) {
  const s = svc();
  let r = await s.round.addRoundScan(auth, roundId, { name: "scan.pdf", data: await samplePdf(2, []), mime: "application/pdf" });
  if (r.feedbackIds.length) r = await s.round.setItemMarks(auth, roundId, r.feedbackIds.map((f) => ({ feedbackId: f.toString(), verdict: "agree" as const, scanPage: 1 })));
  const { BookDecision } = require("../modules/book-lifecycle/models/BookFeedback") as typeof import("../modules/book-lifecycle/models/BookFeedback");
  for (const d of r.decisionIds) {
    const dec = await BookDecision.findById(d).lean();
    r = await s.round.setDecisionMarks(auth, roundId, [{ decisionId: d.toString(), optionKey: dec!.options[0].key, scanPage: 1 }]);
  }
  for (const m of r.itemMarks) await s.round.checkAgainstScan(auth, roundId, { kind: "item", id: m.feedbackId.toString() });
  for (const m of r.decisionMarks) await s.round.checkAgainstScan(auth, roundId, { kind: "decision", id: m.decisionId.toString() });
  return s.round.recordReturn(auth, roundId, { verdict: "approve", returnedAt: new Date("2026-11-12T04:00:00Z") });
}
