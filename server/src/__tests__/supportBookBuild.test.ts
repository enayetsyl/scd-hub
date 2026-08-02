/**
 * Assembly: the gate, the materializer, the queue, and the render sequencing
 * (SB-4, D-#406/#407/#413/#417/#423).
 *
 * The renderer itself cannot run in CI — it needs Chromium, and the VM is aarch64
 * where Puppeteer ships none (D-#413). What CAN be pinned, and is worth pinning, is
 * everything AROUND it: that a doomed build is refused before Chromium is ever
 * launched, that book.json comes out in the pipeline's field names, that the validator
 * runs FIRST and its failure stops the render, and that concurrency stays at 1.
 *
 * The spawn seam is injected, so the sequencing tests are real tests of real logic
 * rather than mocks of the thing under test.
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockBooks: Row[] = [];
const mockLessons: Row[] = [];
const mockJobs: Row[] = [];
const mockEscalations: Row[] = [];
const mockEvents: Row[] = [];
const mockStale = { stale: [] as Array<{ slotId: string; lessonNo: number; stage: string }>, blocksAssembly: false };

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: Row, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
      if (!(v as { $in: unknown[] }).$in.includes(row[k])) return false;
      continue;
    }
    if (v && typeof v === "object" && "$lt" in (v as Record<string, unknown>)) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

jest.mock("../modules/support-book/models/SupportBook", () => ({
  SupportBook: {
    findOne: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockBooks.find((b) => matches(b, q)) ?? null) }),
  },
}));

jest.mock("../modules/support-book/models/SupportBookLesson", () => ({
  SupportBookLesson: {
    find: (q: Record<string, unknown>) => ({
      lean: () => Promise.resolve(mockLessons.filter((l) => matches(l, q))),
      sort: () => ({ lean: () => Promise.resolve([...mockLessons].filter((l) => matches(l, q)).sort((a, b) => (a.lessonNo as number) - (b.lessonNo as number))) }),
    }),
  },
}));

jest.mock("../modules/support-book/models/BookEscalation", () => ({
  BookEscalation: {
    find: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockEscalations.filter((e) => matches(e, q))) }),
  },
}));

jest.mock("../modules/support-book/models/BookBuildJob", () => ({
  BookBuildJob: {
    create: (doc: Row) => { const j = { _id: oid(), ...doc }; mockJobs.push(j); return Promise.resolve(j); },
    findOne: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockJobs.find((j) => matches(j, q)) ?? null) }),
    findOneAndUpdate: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const j = mockJobs.filter((x) => matches(x, q)).sort((a, b) => Number(a.queuedAt) - Number(b.queuedAt))[0];
      if (!j) return Promise.resolve(null);
      Object.assign(j, (u.$set ?? {}) as Row);
      return Promise.resolve(j);
    },
    updateMany: () => Promise.resolve({ modifiedCount: 0 }),
  },
}));

jest.mock("../modules/support-book/services/BookImageService", () => ({
  bookStaleness: () => Promise.resolve(mockStale),
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: Row) => { mockEvents.push(e); return Promise.resolve(); },
}));

import {
  assemblyGate, materializeBookJson, queueBuild, claimNextJob, profilesFor, BuildGateError,
} from "../modules/support-book/services/BookBuildService";
import { renderBook, parsePdfPaths, type CommandRunner } from "../modules/support-book/services/BookRenderRunner";

const BOOK = "C1-BAN";
const WHO = oid();

beforeEach(() => {
  mockBooks.length = 0; mockLessons.length = 0; mockJobs.length = 0;
  mockEscalations.length = 0; mockEvents.length = 0;
  mockStale.stale = []; mockStale.blocksAssembly = false;
  mockBooks.push({
    _id: oid(), bookId: BOOK, bookType: "SUPPORT_BOOK", classLevel: 1, subject: "BAN",
    mode: "R", titleBn: "সহায়িকা", hasTextEn: false, status: "content-draft", versionLog: [],
  });
  mockLessons.push({
    bookId: BOOK, lessonNo: 1, nctbTitleBn: "পাঠ এক", nctbPages: [3], action: "retain",
    competencyCodes: ["১.১"], outcomeCodes: ["১.১.১"], cCodes: [], state: "COMPLIANCE_DONE",
    blocks: [{ id: "L001-b01", text_bn: "আম" }], imageSlots: [{ id: "L001-img-01" }],
    nctbOmitted: [], bwTreatment: "native_safe", reviewerSignoff: { checklistPassed: true, selfReviewed: false },
    notes: "", layout: [],
  });
});

describe("profiles per book type (D-#421)", () => {
  it("a support book renders two editions", () => {
    expect(profilesFor({ bookType: "SUPPORT_BOOK" } as never)).toEqual(["print-colour", "bw-photocopy"]);
  });
  it("a storybook renders six", () => {
    expect(profilesFor({ bookType: "STORYBOOK" } as never)).toHaveLength(6);
  });
});

describe("the assembly gate — refuses BEFORE Chromium is launched", () => {
  it("passes a clean book", async () => {
    const g = await assemblyGate(BOOK, []);
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it("REFUSES on stale artifacts and NAMES the files (D-#417)", async () => {
    mockStale.stale = [{ slotId: "L001-img-01", lessonNo: 1, stage: "COMPLIANT" }];
    mockStale.blocksAssembly = true;
    const g = await assemblyGate(BOOK, []);
    expect(g.ok).toBe(false);
    expect(g.reasons[0]).toContain("L001-img-01 COMPLIANT");
  });

  it("REFUSES while an escalation is unresolved — ANSWERED included", async () => {
    mockEscalations.push({ bookId: BOOK, lessonNo: 1, state: "ANSWERED", target: "BLOCK", targetId: "L001-b01" });
    const g = await assemblyGate(BOOK, []);
    expect(g.ok).toBe(false);
    expect(g.reasons.join(" ")).toContain("unresolved escalation");
  });

  it("refuses an empty scope rather than rendering nothing", async () => {
    const g = await assemblyGate(BOOK, [99]);
    expect(g.ok).toBe(false);
    expect(g.reasons.join(" ")).toContain("no lessons in scope");
  });

  it("reports EVERY reason at once, not the first", async () => {
    // Fixing one blocker only to be told about the next is the worst version of a gate.
    mockStale.stale = [{ slotId: "L001-img-01", lessonNo: 1, stage: "COMPLIANT" }];
    mockStale.blocksAssembly = true;
    mockEscalations.push({ bookId: BOOK, lessonNo: 1, state: "OPEN", target: "BLOCK", targetId: "b1" });
    const g = await assemblyGate(BOOK, []);
    expect(g.reasons).toHaveLength(2);
  });
});

describe("queueing", () => {
  it("queues when the gate passes", async () => {
    const j = await queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO });
    expect(j.state).toBe("QUEUED");
    expect(j.profiles).toEqual(["print-colour", "bw-photocopy"]);
    expect(mockEvents.some((e) => e.kind === "BUILD_QUEUED")).toBe(true);
  });

  it("throws BuildGateError when the gate fails", async () => {
    mockStale.blocksAssembly = true;
    mockStale.stale = [{ slotId: "s", lessonNo: 1, stage: "COMPLIANT" }];
    await expect(queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO })).rejects.toBeInstanceOf(BuildGateError);
    expect(mockJobs).toHaveLength(0);
  });

  it("force RECORDS the override rather than hiding it", async () => {
    mockStale.blocksAssembly = true;
    mockStale.stale = [{ slotId: "s", lessonNo: 1, stage: "COMPLIANT" }];
    const j = await queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO, force: true });
    expect(String(j.log)).toContain("GATE OVERRIDDEN");
    const ev = mockEvents.find((e) => e.kind === "BUILD_QUEUED")!;
    expect(String(ev.summary)).toContain("GATE OVERRIDDEN");
    expect(ev.reason).toBeTruthy();
  });
});

describe("concurrency is 1 (D-#423 — the VM has no swap)", () => {
  it("claims the oldest queued job", async () => {
    await queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO });
    const j = await claimNextJob("w1");
    expect(j).not.toBeNull();
    expect(j!.state).toBe("RUNNING");
    expect(j!.workerId).toBe("w1");
  });

  it("REFUSES to claim while another job is RUNNING", async () => {
    await queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO });
    await queueBuild({ bookId: BOOK, scope: "FULL", queuedBy: WHO });
    expect(await claimNextJob("w1")).not.toBeNull();
    // A second worker starting must not be able to violate the memory constraint.
    expect(await claimNextJob("w2")).toBeNull();
  });

  it("returns null on an empty queue", async () => {
    expect(await claimNextJob("w1")).toBeNull();
  });
});

describe("materializing book.json (D-#406)", () => {
  it("emits the pipeline's SCHEMA field names, not our model's", async () => {
    const b = await materializeBookJson(BOOK);
    expect(b.book_id).toBe(BOOK);
    expect(b.schema_version).toBe("1.3");
    const l = (b.lessons as Record<string, unknown>[])[0];
    // snake_case is the contract the frozen CLI reads; camelCase would silently
    // produce a book the renderer cannot understand.
    expect(l.lesson_no).toBe(1);
    expect(l.nctb_pages).toEqual([3]);
    expect(l.bw_treatment).toBe("native_safe");
    expect(l.image_slots).toHaveLength(1);
    expect((l.reviewer_signoff as Record<string, unknown>).checklist_passed).toBe(true);
  });

  it("scopes to the requested lessons", async () => {
    mockLessons.push({ ...mockLessons[0], lessonNo: 2 });
    expect((await materializeBookJson(BOOK) as { lessons: unknown[] }).lessons).toHaveLength(2);
    expect((await materializeBookJson(BOOK, [1]) as { lessons: unknown[] }).lessons).toHaveLength(1);
  });

  it("throws on an unknown book", async () => {
    await expect(materializeBookJson("NOPE")).rejects.toBeInstanceOf(BuildGateError);
  });
});

describe("render sequencing (spawn seam injected — no Chromium in CI)", () => {
  const bookJson = { book_id: BOOK, lessons: [] };

  it("runs the validator FIRST and does not build when it fails", async () => {
    // Chromium is the expensive step; a book failing a JSON check has no business
    // reaching it.
    const calls: string[][] = [];
    const runner: CommandRunner = (_cmd, args) => {
      calls.push(args);
      return Promise.resolve({ code: args[0].includes("validate") ? 1 : 0, stdout: "RED: 3", stderr: "" });
    };
    const r = await renderBook({ bookId: BOOK, bookJson, images: new Map(), runner });
    expect(r.ok).toBe(false);
    expect(r.failureReason).toContain("validator refused");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("validate-studybook.js");
  });

  it("builds after a green validator, and reports the PDFs", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = (_cmd, args) => {
      calls.push(args);
      return Promise.resolve({
        code: 0,
        stdout: args[0].includes("build") ? "wrote out/C1-BAN/C1-BAN-bn-print-colour.pdf and out/C1-BAN/C1-BAN-bn-bw-photocopy.pdf" : "RESULT: PASS",
        stderr: "",
      });
    };
    const r = await renderBook({ bookId: BOOK, bookJson, images: new Map(), runner });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toContain("build-book.js");
    expect(r.pdfPaths).toHaveLength(2);
  });

  it("fails the WHOLE job when the build exits non-zero (ASSEMBLY §5)", async () => {
    // A single-edition success is not a pass.
    const runner: CommandRunner = (_cmd, args) =>
      Promise.resolve({ code: args[0].includes("build") ? 1 : 0, stdout: "fit guard: পাঠ 31 overflows", stderr: "" });
    const r = await renderBook({ bookId: BOOK, bookJson, images: new Map(), runner });
    expect(r.ok).toBe(false);
    expect(r.buildLog).toContain("পাঠ 31");
  });

  it("streams the log as each command finishes (D-#418)", async () => {
    const chunks: string[] = [];
    const runner: CommandRunner = () => Promise.resolve({ code: 0, stdout: "line\n", stderr: "" });
    await renderBook({ bookId: BOOK, bookJson, images: new Map(), runner, onLog: (c) => chunks.push(c) });
    // materialize + validator + build
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]).toContain("materialized");
  });

  it("never composes a shell string — args are an array", async () => {
    // The paths carry a book id and Bangla filenames; shell quoting is exactly where
    // that goes wrong.
    const runner: CommandRunner = (cmd, args) => {
      expect(Array.isArray(args)).toBe(true);
      expect(cmd).toBe("node");
      expect(args.join(" ")).not.toContain("&&");
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    await renderBook({ bookId: BOOK, bookJson, images: new Map(), runner });
  });
});

describe("parsePdfPaths", () => {
  it("reads the paths the build script printed", () => {
    const paths = parsePdfPaths("wrote a/b/X-bn-print-colour.pdf\nwrote a/b/X-bn-bw-photocopy.pdf", "out", "X");
    expect(paths).toEqual(["a/b/X-bn-print-colour.pdf", "a/b/X-bn-bw-photocopy.pdf"]);
  });

  it("falls back to the documented convention rather than failing a good render", () => {
    const paths = parsePdfPaths("done, no paths here", "out", "X");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain("X-bn-print-colour.pdf");
  });

  it("de-duplicates a path the log mentions twice", () => {
    expect(parsePdfPaths("x/y.pdf and again x/y.pdf", "out", "X")).toEqual(["x/y.pdf"]);
  });
});
