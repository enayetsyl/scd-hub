/**
 * Image lineage + staleness (SB-2, D-#417).
 *
 * The prd acceptance, verbatim: "Re-approving one slot flips only that slot's
 * downstream artifacts to STALE, and the build refuses while any STALE remains" and
 * "the stale list names files, not stages".
 *
 * DB-free — `BookImageAsset` and `writeBookEvent` are mocked with in-memory stores
 * (the accessControl.test.ts pattern; everything inside a jest.mock factory is
 * `mock`-prefixed for babel-plugin-jest-hoist).
 *
 * The failure this whole mechanism exists to prevent is SILENT: a re-approved image
 * whose compliant version was never regenerated still builds a valid PDF — it just
 * prints the old picture. So the tests care less about the happy path than about
 * whether staleness actually propagates and actually blocks.
 */
import { Types } from "mongoose";

interface MockAsset { [k: string]: unknown }
const mockAssets: MockAsset[] = [];
const mockEvents: MockAsset[] = [];

const oid = (): Types.ObjectId => new Types.ObjectId();

function matches(row: MockAsset, q: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(q)) {
    if (row[k] !== v) return false;
  }
  return true;
}

jest.mock("../modules/support-book/models/BookImageAsset", () => ({
  BookImageAsset: {
    findOne: (q: Record<string, unknown>) => {
      const hit = mockAssets.find((a) => matches(a, q)) ?? null;
      return Object.assign(Promise.resolve(hit), { lean: () => Promise.resolve(hit) });
    },
    find: (q: Record<string, unknown>) => ({
      sort: () => ({ lean: () => Promise.resolve(mockAssets.filter((a) => matches(a, q))) }),
    }),
    distinct: (field: string, q: Record<string, unknown>) =>
      Promise.resolve([...new Set(mockAssets.filter((a) => matches(a, q)).map((a) => a[field]))]),
    updateOne: (q: Record<string, unknown>, u: Record<string, unknown>) => {
      const row = mockAssets.find((a) => String(a._id) === String(q._id));
      if (row) Object.assign(row, (u.$set ?? {}) as MockAsset);
      return Promise.resolve({ acknowledged: true });
    },
    create: (doc: MockAsset) => {
      const row = { _id: oid(), ...doc };
      mockAssets.push(row);
      return Promise.resolve(row);
    },
  },
}));

jest.mock("../modules/support-book/models/BookEvent", () => ({
  writeBookEvent: (e: MockAsset) => { mockEvents.push(e); return Promise.resolve(); },
}));

import {
  registerAsset, stageState, slotLineage, bookStaleness, upstreamOf, fingerprintOf,
} from "../modules/support-book/services/BookImageService";

const BOOK = "C1-BAN";
const WHO = new Types.ObjectId();

/** Push one artifact through a stage and return the StoredFile id used. */
async function put(slotId: string, stage: "APPROVED" | "CROPPED" | "UPSCALED" | "COMPLIANT", lessonNo = 12) {
  const storedFileId = oid();
  await registerAsset({ bookId: BOOK, lessonNo, slotId, stage, storedFileId, uploadedBy: WHO,
    ...(stage === "APPROVED" ? { source: "EXTERNAL_UPLOAD" as const } : {}) });
  return storedFileId;
}

/** A complete, fresh chain for one slot. */
async function fullChain(slotId: string, lessonNo = 12) {
  await put(slotId, "APPROVED", lessonNo);
  await put(slotId, "CROPPED", lessonNo);
  await put(slotId, "UPSCALED", lessonNo);
  await put(slotId, "COMPLIANT", lessonNo);
}

beforeEach(() => { mockAssets.length = 0; mockEvents.length = 0; });

describe("the chain", () => {
  it("APPROVED is the head — derived from nothing", () => {
    expect(upstreamOf("APPROVED")).toBeNull();
    expect(upstreamOf("CROPPED")).toBe("APPROVED");
    expect(upstreamOf("UPSCALED")).toBe("CROPPED");
    expect(upstreamOf("COMPLIANT")).toBe("UPSCALED");
  });

  it("a complete chain is FRESH end to end", async () => {
    await fullChain("L012-img-01");
    const lin = await slotLineage(BOOK, "L012-img-01");
    expect(lin!.stages).toEqual({
      APPROVED: "FRESH", CROPPED: "FRESH", UPSCALED: "FRESH", COMPLIANT: "FRESH",
    });
    expect(lin!.hasStale).toBe(false);
  });

  it("an unstarted stage is MISSING, not stale", async () => {
    await put("L012-img-02", "APPROVED");
    expect(await stageState(BOOK, "L012-img-02", "CROPPED")).toBe("MISSING");
  });
});

describe("re-approval propagates staleness (the D-#417 acceptance)", () => {
  it("flips EVERY downstream stage of that slot to STALE", async () => {
    await fullChain("L012-img-01");
    await put("L012-img-01", "APPROVED"); // the illustrator brings a better image

    const lin = await slotLineage(BOOK, "L012-img-01");
    expect(lin!.stages.APPROVED).toBe("FRESH");   // the new head is fine
    expect(lin!.stages.CROPPED).toBe("STALE");
    expect(lin!.stages.UPSCALED).toBe("STALE");
    expect(lin!.stages.COMPLIANT).toBe("STALE");  // ← this is what would print
  });

  it("touches ONLY that slot — a neighbour stays clean", async () => {
    await fullChain("L012-img-01");
    await fullChain("L012-img-02");
    await put("L012-img-01", "APPROVED");

    expect((await slotLineage(BOOK, "L012-img-01"))!.hasStale).toBe(true);
    expect((await slotLineage(BOOK, "L012-img-02"))!.hasStale).toBe(false);
  });

  it("re-running the affected stages clears it", async () => {
    await fullChain("L012-img-01");
    await put("L012-img-01", "APPROVED");
    await put("L012-img-01", "CROPPED");
    await put("L012-img-01", "UPSCALED");
    await put("L012-img-01", "COMPLIANT");

    const lin = await slotLineage(BOOK, "L012-img-01");
    expect(lin!.hasStale).toBe(false);
  });

  it("re-running only PART of the chain leaves the rest stale", async () => {
    // The realistic mistake: someone re-crops and re-upscales, then forgets strips.
    await fullChain("L012-img-01");
    await put("L012-img-01", "APPROVED");
    await put("L012-img-01", "CROPPED");
    await put("L012-img-01", "UPSCALED");

    const lin = await slotLineage(BOOK, "L012-img-01");
    expect(lin!.stages.CROPPED).toBe("FRESH");
    expect(lin!.stages.UPSCALED).toBe("FRESH");
    expect(lin!.stages.COMPLIANT).toBe("STALE"); // still the old picture
    expect(lin!.hasStale).toBe(true);
  });

  it("supersedes rather than overwrites — the replaced artifact stays readable", async () => {
    const first = await put("L012-img-01", "APPROVED");
    await put("L012-img-01", "APPROVED");
    const rows = mockAssets.filter((a) => a.slotId === "L012-img-01" && a.stage === "APPROVED");
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.fingerprint === fingerprintOf(first))!;
    expect(old.current).toBe(false);
    expect(rows.find((r) => r.current === true)!.supersedes).toBeDefined();
  });
});

describe("the build gate", () => {
  it("names FILES, not stages, and blocks assembly", async () => {
    await fullChain("L012-img-01");
    await fullChain("L012-img-02");
    await put("L012-img-01", "APPROVED");

    const report = await bookStaleness(BOOK);
    expect(report.blocksAssembly).toBe(true);
    // Three stale artifacts, all naming the offending slot.
    expect(report.stale).toHaveLength(3);
    expect(report.stale.every((s) => s.slotId === "L012-img-01")).toBe(true);
    expect(report.stale.map((s) => s.stage).sort()).toEqual(["COMPLIANT", "CROPPED", "UPSCALED"]);
    expect(report.stale.every((s) => s.lessonNo === 12)).toBe(true);
  });

  it("a clean book does not block", async () => {
    await fullChain("L012-img-01");
    const report = await bookStaleness(BOOK);
    expect(report.blocksAssembly).toBe(false);
    expect(report.stale).toEqual([]);
  });

  it("an artifact whose input VANISHED is stale, not fresh", async () => {
    // Derived from something the book no longer has — the one case a naive
    // "compare to upstream" check reports as fine because there is nothing to compare.
    await fullChain("L012-img-01");
    const upstreamRows = mockAssets.filter((a) => a.slotId === "L012-img-01" && a.stage === "UPSCALED");
    for (const r of upstreamRows) r.current = false;
    expect(await stageState(BOOK, "L012-img-01", "COMPLIANT")).toBe("STALE");
  });
});

describe("the editorial trail (D-#411)", () => {
  it("records an upload, a replacement, and the staleness it caused", async () => {
    await fullChain("L012-img-01");
    mockEvents.length = 0;
    await put("L012-img-01", "APPROVED");

    const kinds = mockEvents.map((e) => e.kind);
    expect(kinds).toContain("IMAGE_SUPERSEDED");
    expect(kinds).toContain("LINEAGE_STALE");
    const stale = mockEvents.find((e) => e.kind === "LINEAGE_STALE")!;
    expect(String(stale.summary)).toContain("COMPLIANT");
  });

  it("a first upload is IMAGE_UPLOADED and causes no staleness event", async () => {
    await put("L012-img-09", "APPROVED");
    expect(mockEvents.map((e) => e.kind)).toEqual(["IMAGE_UPLOADED"]);
  });

  it("records which path the artwork came by (D-#419)", async () => {
    await put("L012-img-01", "APPROVED");
    const row = mockAssets.find((a) => a.stage === "APPROVED")!;
    expect(row.source).toBe("EXTERNAL_UPLOAD");
  });
});

describe("an independently-produced artifact is NOT stale (D-#437)", () => {
  // The primary workflow: the crop/upscale/strip chain runs on a laptop and only the
  // finished COMPLIANT file is uploaded (D-#409). Treating a never-existed upstream as
  // "vanished" made the assembly gate refuse a correctly-prepared book forever — found
  // on prod with a real 10.5 MB image from C1-BAN.
  it("COMPLIANT uploaded alone is FRESH, and the book can build", async () => {
    await put("L001-img-01", "COMPLIANT");
    const lin = await slotLineage(BOOK, "L001-img-01");
    expect(lin!.stages.APPROVED).toBe("MISSING");
    expect(lin!.stages.COMPLIANT).toBe("FRESH");
    expect(lin!.hasStale).toBe(false);
    expect((await bookStaleness(BOOK)).blocksAssembly).toBe(false);
  });

  it("but an artifact whose upstream ACTUALLY vanished is still STALE", async () => {
    // The distinction is a prior relationship: this one was derived from something,
    // and that something is gone.
    await fullChain("L001-img-02");
    for (const r of mockAssets.filter((a) => a.slotId === "L001-img-02" && a.stage === "UPSCALED")) r.current = false;
    expect(await stageState(BOOK, "L001-img-02", "COMPLIANT")).toBe("STALE");
  });
});
