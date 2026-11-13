/**
 * BL-1 — the editorial log and the main audit (docs/prd-book-lifecycle.md §5.14, §18, §19 bookLcEvents).
 * One BookEvent (flow LIFECYCLE) per write; CONTENT_READ once per user/version/surface/day; main
 * Audit rows never carry book text (asserted with marker strings).
 */
jest.mock("../modules/platform/services/DriveStore", () => require("./bookLcFixtures").driveMock);
import { setupLc, teardownLc, resetBooks, sampleMaster, item, roundSent, approveOnPaper, type LcFx } from "./bookLcFixtures";
import { importBook } from "../modules/book-lifecycle/services/versionService";
import { recordContentRead } from "../modules/book-lifecycle/services/events";
import { BookEvent } from "../modules/support-book/models/BookEvent";
import { Audit } from "../modules/platform/models/Audit";

let fx: LcFx;
beforeAll(async () => {
  fx = await setupLc();
});
afterAll(async () => teardownLc(fx));
beforeEach(async () => resetBooks());
const P = () => fx.auth.principal;
const MARK = "MARKERBOOKTEXT7781";

it("writes one LIFECYCLE BookEvent per write, and no book text reaches the main Audit", async () => {
  await Audit.deleteMany({});
  const { book, version } = await importBook(P(), { code: "C4-SCI", classLevel: 4, subject: "SCI", titleBn: "বিজ্ঞান (কাল্পনিক)", version: "v2", state: "draft", masterMd: Buffer.from(sampleMaster({ extra: `## ${MARK}\n${MARK} লেখা\n` })) });
  const f = await item(P(), book._id.toString(), "needs_reviewer", { textBn: `${MARK} মতামত`, quote: MARK });
  const r = await roundSent(P(), book._id.toString());
  await approveOnPaper(P(), r._id.toString());
  const events = await BookEvent.find({ bookId: book._id.toString() }).lean();
  expect(events.length).toBeGreaterThan(5);
  expect(events.every((e) => e.flow === "LIFECYCLE")).toBe(true);
  const kinds = events.map((e) => e.kind);
  for (const k of ["BOOK_LC_CREATED", "VERSION_CREATED", "FEEDBACK_FILED", "FEEDBACK_TRIAGED", "ROUND_OPENED", "PACKET_MADE", "ROUND_SENT_ON_PAPER", "FILE_UPLOADED", "SCAN_CHECKED", "ROUND_RETURN_RECORDED", "FEEDBACK_RULED", "VERSION_STATUS"]) {
    expect(kinds).toContain(k);
  }
  expect(kinds.filter((k) => k === "VERSION_CREATED")).toHaveLength(1);
  expect(events.find((e) => e.kind === "FEEDBACK_FILED")?.refs?.feedbackId?.equals(f._id)).toBe(true);
  const audits = await Audit.find({}).lean();
  expect(audits.some((a) => a.eventKind === "BOOK_LC_VERSION_CREATED")).toBe(true);
  expect(audits.some((a) => a.eventKind === "BOOK_LC_FINALIZED")).toBe(true);
  expect(JSON.stringify(audits)).not.toContain(MARK);
  expect(JSON.stringify(events)).not.toContain(MARK);
  expect(version.chapters.some((c) => c.title.includes(MARK))).toBe(true);
});

it("CONTENT_READ is written once per user / version / surface / Dhaka day", async () => {
  const { book, version } = await importBook(P(), { code: "C4-SCI", classLevel: 4, subject: "SCI", titleBn: "বিজ্ঞান", version: "v1", state: "draft", masterMd: Buffer.from(sampleMaster()) });
  for (let i = 0; i < 3; i++) await recordContentRead({ bookId: book._id, versionId: version._id, userId: P().userId, surface: "app" });
  await recordContentRead({ bookId: book._id, versionId: version._id, userId: P().userId, surface: "mcp" });
  await recordContentRead({ bookId: book._id, versionId: version._id, userId: fx.auth.officeManage.userId, surface: "app" });
  const rows = await BookEvent.find({ kind: "CONTENT_READ" }).lean();
  expect(rows).toHaveLength(3);
  expect(rows.find((r) => r.origin === "claude")).toBeDefined();
});
