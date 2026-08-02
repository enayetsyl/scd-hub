/**
 * The build worker (SB-4, D-#407/#418/#423).
 *
 * What is worth pinning is the failure handling, not the happy path: a render that
 * fails must mark the job and KEEP THE QUEUE DRAINING, the work directory must be
 * cleaned up whatever happened, and one worker must never run two jobs at once.
 *
 * Drive and the spawn are both injected, so nothing here touches a network or a
 * browser.
 */
import { Types } from "mongoose";

interface Row { [k: string]: unknown }
const mockJobs: Row[] = [];
const mockLessons: Row[] = [];
const mockAssets: Row[] = [];
const mockFiles: Row[] = [];
const mockEvents: Row[] = [];
const mockDownloads: string[] = [];
const mockUploads: Row[] = [];

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: Row, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
      if (!(v as { $in: unknown[] }).$in.includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

jest.mock("../modules/support-book/models/BookBuildJob", () => ({
  BookBuildJob: {
    findById: (id: unknown) => {
      const hit = mockJobs.find((j) => String(j._id) === String(id)) ?? null;
      const p = Promise.resolve(hit) as Promise<Row | null> & {
        select?: () => { lean: () => Promise<Row | null> };
      };
      p.select = () => ({ lean: () => Promise.resolve(hit) });
      return p;
    },
    updateOne: (q: Record<string, unknown>, u: unknown) => {
      const j = mockJobs.find((x) => String(x._id) === String(q._id));
      if (!j) return Promise.resolve({ acknowledged: true });
      if (Array.isArray(u)) {
        // aggregation-pipeline update: only $concat on log is used
        j.log = String(j.log ?? "") + "…";
      } else {
        Object.assign(j, ((u as Record<string, unknown>).$set ?? {}) as Row);
      }
      return Promise.resolve({ acknowledged: true });
    },
    findOne: () => ({ lean: () => Promise.resolve(mockJobs.find((j) => j.state === "RUNNING") ?? null) }),
    findOneAndUpdate: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const j = mockJobs.filter((x) => matches(x, q))[0];
      if (!j) return Promise.resolve(null);
      Object.assign(j, (u.$set ?? {}) as Row);
      return Promise.resolve(j);
    },
    updateMany: () => Promise.resolve({ modifiedCount: 0 }),
  },
}));

jest.mock("../modules/support-book/models/SupportBookLesson", () => ({
  SupportBookLesson: {
    find: (q: Record<string, unknown>) => ({
      lean: () => Promise.resolve(mockLessons.filter((l) => matches(l, q))),
      sort: () => ({ lean: () => Promise.resolve(mockLessons.filter((l) => matches(l, q))) }),
    }),
  },
}));

jest.mock("../modules/support-book/models/BookImageAsset", () => ({
  BookImageAsset: {
    findOne: (q: Record<string, unknown>) => ({ lean: () => Promise.resolve(mockAssets.find((a) => matches(a, q)) ?? null) }),
  },
}));

jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: {
    findById: (id: unknown) => ({ lean: () => Promise.resolve(mockFiles.find((f) => String(f._id) === String(id)) ?? null) }),
    create: (d: Row) => { const f = { _id: oid(), ...d }; mockFiles.push(f); return Promise.resolve(f); },
  },
}));

class MockDriveDown extends Error {}
jest.mock("../modules/platform/services/DriveStore", () => ({
  uploadToDrive: (i: Row) => { mockUploads.push(i); return Promise.resolve("drive-" + mockUploads.length); },
  downloadFromDrive: (id: string) => { mockDownloads.push(id); return Promise.resolve(Buffer.from("PNG")); },
  DriveUnavailableError: MockDriveDown,
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: Row) => { mockEvents.push(e); return Promise.resolve(); },
}));

jest.mock("../modules/support-book/services/BookBuildService", () => ({
  materializeBookJson: () => Promise.resolve({ book_id: "C1-BAN", lessons: [] }),
  claimNextJob: () => Promise.resolve(mockJobs.find((j) => j.state === "QUEUED") ?? null),
  requeueStuckJobs: () => Promise.resolve(0),
}));

import { runJob, gatherCompliantImages, workerLoop } from "../modules/support-book/services/BookBuildWorker";
import type { CommandRunner } from "../modules/support-book/services/BookRenderRunner";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join as pathJoin } from "path";

const BOOK = "C1-BAN";
const WHO = oid();

function seedJob(state = "RUNNING"): Row {
  const j: Row = {
    _id: oid(), bookId: BOOK, scope: "FULL", lessonNos: [], state,
    profiles: ["print-colour", "bw-photocopy"], queuedBy: WHO, log: "", outputs: [],
  };
  mockJobs.push(j);
  return j;
}

/**
 * Writes REAL files at the paths it reports, so readPdf and the upload path actually
 * run. A runner that only PRINTS paths leaves the whole upload half of runJob
 * untested — which is exactly what the first version of this file did, and how the
 * empty-outputs hole below was found.
 */
const okRunner: CommandRunner = async (_c, args) => {
  if (!args[0].includes("build")) return { code: 0, stdout: "RESULT: PASS", stderr: "" };
  const outDir = args[args.indexOf("--out") + 1];
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const n of ["C1-BAN-bn-print-colour.pdf", "C1-BAN-bn-bw-photocopy.pdf"]) {
    const full = pathJoin(outDir, n);
    await writeFile(full, Buffer.from("%PDF-1.4 fake"));
    written.push(full);
  }
  return { code: 0, stdout: written.map((w) => `wrote ${w}`).join("\n"), stderr: "" };
};

beforeEach(() => {
  mockJobs.length = 0; mockLessons.length = 0; mockAssets.length = 0;
  mockFiles.length = 0; mockEvents.length = 0; mockDownloads.length = 0; mockUploads.length = 0;
});

describe("gathering compliant images", () => {
  it("keys by the FILENAME book.json names, not the slot id", async () => {
    // The renderer resolves the filename; keying by slot id would write files the
    // composer never looks for.
    const fileId = oid();
    mockLessons.push({ bookId: BOOK, lessonNo: 1, imageSlots: [{ id: "L001-img-01", filename: "L001-img-01_school.png" }] });
    mockAssets.push({ bookId: BOOK, slotId: "L001-img-01", stage: "COMPLIANT", current: true, storedFileId: fileId });
    mockFiles.push({ _id: fileId, driveFileId: "drive-abc" });

    const { images, missing } = await gatherCompliantImages(BOOK, []);
    expect([...images.keys()]).toEqual(["L001-img-01_school.png"]);
    expect(missing).toEqual([]);
    expect(mockDownloads).toEqual(["drive-abc"]);
  });

  it("reports a slot with no compliant image rather than substituting one", async () => {
    mockLessons.push({ bookId: BOOK, lessonNo: 1, imageSlots: [{ id: "L001-img-01", filename: "a.png" }] });
    const { images, missing } = await gatherCompliantImages(BOOK, []);
    expect(images.size).toBe(0);
    expect(missing).toEqual(["L001-img-01"]);
  });

  it("skips a slot with no filename — the validator owns that judgement", async () => {
    // Duplicating it here would put two sources of truth on the same question.
    mockLessons.push({ bookId: BOOK, lessonNo: 1, imageSlots: [{ id: "L001-img-01" }] });
    const { images, missing } = await gatherCompliantImages(BOOK, []);
    expect(images.size).toBe(0);
    expect(missing).toEqual([]);
  });
});

describe("running a job", () => {
  it("uploads each PDF and marks the job SUCCEEDED", async () => {
    const job = seedJob();
    await runJob(job as never, { runner: okRunner });
    expect(job.state).toBe("SUCCEEDED");
    expect(mockUploads).toHaveLength(2);
    expect((job.outputs as unknown[])).toHaveLength(2);
    expect(mockEvents.some((e) => e.kind === "BUILD_SUCCEEDED")).toBe(true);
  });

  it("files each PDF under books/<id>/pdf with its profile tagged", async () => {
    const job = seedJob();
    await runJob(job as never, { runner: okRunner });
    expect(String(mockUploads[0].subfolder)).toBe(`books/${BOOK}/pdf`);
    const props = mockUploads[0].appProperties as Record<string, string>;
    expect(props.bookId).toBe(BOOK);
    expect(props.profile).toBe("print-colour");
  });

  it("derives the profile from the FILENAME, not the output order", async () => {
    // Order changes the day a profile is added; the filename does not.
    const job = seedJob();
    await runJob(job as never, { runner: okRunner });
    const profiles = mockUploads.map((u) => (u.appProperties as Record<string, string>).profile);
    expect(profiles).toEqual(["print-colour", "bw-photocopy"]);
  });

  it("marks FAILED with the reason when the validator refuses — and uploads nothing", async () => {
    const job = seedJob();
    const refuse: CommandRunner = (_c, args) =>
      Promise.resolve({ code: args[0].includes("validate") ? 1 : 0, stdout: "RED: 3", stderr: "" });
    await runJob(job as never, { runner: refuse });
    expect(job.state).toBe("FAILED");
    expect(String(job.failureReason)).toContain("validator refused");
    expect(mockUploads).toHaveLength(0);
    expect(mockEvents.some((e) => e.kind === "BUILD_FAILED")).toBe(true);
  });

  it("does NOT throw when Drive is down — it records and moves on", async () => {
    // The queue must keep draining; losing the worker to one bad upload is worse than
    // one failed job.
    const job = seedJob();
    const boom = () => { throw new MockDriveDown("drive down"); };
    await expect(runJob(job as never, { runner: okRunner, upload: boom as never })).resolves.toBeDefined();
    expect(job.state).toBe("FAILED");
    expect(String(job.failureReason)).toContain("Drive");
  });

  it("cleans up the work directory even when the render fails", async () => {
    // Half a gigabyte of PNGs per abandoned render fills the disk within a week.
    const seen: string[] = [];
    const job = seedJob();
    const fail: CommandRunner = (_c, args) => {
      const bookArg = args.find((a) => a.endsWith("book.json"));
      if (bookArg) seen.push(bookArg.replace(/[\\/]book\.json$/, ""));
      return Promise.resolve({ code: 1, stdout: "boom", stderr: "" });
    };
    await runJob(job as never, { runner: fail });
    expect(seen).toHaveLength(1);
    expect(existsSync(seen[0])).toBe(false);
  });

  it("warns about slots with no compliant image but still renders", async () => {
    mockLessons.push({ bookId: BOOK, lessonNo: 1, imageSlots: [{ id: "L001-img-01", filename: "a.png" }] });
    const job = seedJob();
    await runJob(job as never, { runner: okRunner });
    expect(job.state).toBe("SUCCEEDED");
    expect(String(job.log)).not.toBe("");
  });
});

describe("the loop", () => {
  it("runs a queued job then stops when the queue empties", async () => {
    seedJob("QUEUED");
    const ran = await workerLoop({ workerId: "w1", maxIterations: 3, runner: okRunner });
    expect(ran).toBe(1);
    expect(mockJobs[0].state).toBe("SUCCEEDED");
  });

  it("does nothing on an empty queue", async () => {
    const ran = await workerLoop({ workerId: "w1", maxIterations: 2, runner: okRunner });
    expect(ran).toBe(0);
  });

  it("stops when asked, without starting another job", async () => {
    seedJob("QUEUED");
    const ran = await workerLoop({ workerId: "w1", maxIterations: 5, runner: okRunner, shouldStop: () => true });
    expect(ran).toBe(0);
    expect(mockJobs[0].state).toBe("QUEUED");
  });
});

describe("a render that files nothing is NOT a success", () => {
  it("marks FAILED when no PDF could be read", async () => {
    // The runner claims success and names paths that do not exist. Without the guard
    // the job goes green with an empty outputs list, and the assembler is told the
    // book was built with nothing to download — the worst possible combination.
    const job = seedJob();
    const liar: CommandRunner = (_c, args) =>
      Promise.resolve({
        code: 0,
        stdout: args[0].includes("build") ? "wrote /nowhere/ghost.pdf" : "RESULT: PASS",
        stderr: "",
      });
    await runJob(job as never, { runner: liar });
    expect(job.state).toBe("FAILED");
    expect(String(job.failureReason)).toContain("no readable PDF");
    expect(mockUploads).toHaveLength(0);
  });
});
