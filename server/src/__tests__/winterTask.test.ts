/**
 * D-#1620 — winter-task booklet review (docs/prd-winter-task.md).
 *
 *   permissions  Office / Teacher without a grant are refused; a reviewer can't accept, set a
 *                status or export; the Principal can
 *   import       the exported JSON is validated; dry run writes nothing; a re-import keeps a
 *                suggestion whose block + `before` text still match and marks the others stale
 *   suggest      one OPEN suggestion per person per block (a second tap edits it); a page note
 *                needs text; fixed [line] blocks and unknown blocks are refused
 *   own only     edit / delete touch only the person's own OPEN suggestion
 *   decide       accept applies `after` to the accepted text and the export; reject doesn't;
 *                a stale suggestion can't be accepted; a decided one can't be decided again
 *   audit        every write leaves an audit row
 *
 * In-memory MongoDB, real services. Booklet text in the fixtures is made up.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { Audit } from "../modules/platform/models/Audit";
import { User } from "../modules/foundation/models/User";
import { WinterBooklet } from "../modules/winter-task/models/WinterBooklet";
import { WinterBookletChange } from "../modules/winter-task/models/WinterBookletChange";
import {
  WINTER_ERRORS_BN,
  decideWinterChange,
  deleteWinterChange,
  editWinterChange,
  exportAcceptedWinterBooklet,
  getWinterBooklet,
  importWinterBooklet,
  listWinterBooklets,
  setWinterBookletStatus,
  suggestWinterChange,
  validateWinterImport,
  winterChanges,
} from "../modules/winter-task/services/WinterBookletService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([WinterBooklet, WinterBookletChange, Audit, User].map((m) => (m as unknown as mongoose.Model<unknown>).deleteMany({})));
});

const ctxOf = (userId: string, role: string, granted: string[] = []): AppContext =>
  ({ auth: { userId, role, grantedPermissions: granted } } as unknown as AppContext);
const id = () => new Types.ObjectId().toString();
const principal = ctxOf(id(), "PRINCIPAL");
const reviewer = ctxOf(id(), "TEACHER", ["winter_task:review"]);
const reviewer2 = ctxOf(id(), "TEACHER", ["winter_task:review"]);
const office = ctxOf(id(), "OFFICE");
const teacher = ctxOf(id(), "TEACHER");

function fixture(over: Record<string, unknown> = {}) {
  return {
    code: "T9-2026",
    classLevel: 3,
    titleBn: "পরীক্ষার খাতা",
    version: 1,
    pages: [
      { n: 1, kind: "COVER", blocks: [{ id: "c-title", kind: "heading", textBn: "নমুনা শিরোনাম" }] },
      {
        n: 2,
        kind: "DAY",
        dateKey: "2026-12-12",
        subject: "গণিত",
        week: 1,
        blocks: [
          { id: "d1-read", kind: "prompt", labelBn: "পড়ি জোরে", textBn: "নমুনা পড়ার লেখা" },
          { id: "d1-t1", kind: "text", textBn: "এক যোগ এক = {box}" },
          { id: "d1-t2", kind: "line", textBn: "[লেখার লাইন × 3]" },
        ],
      },
    ],
    ...over,
  };
}

async function load(over: Record<string, unknown> = {}): Promise<string> {
  const v = validateWinterImport(fixture(over));
  if (!v.ok) throw new Error(v.errors.join(";"));
  await importWinterBooklet(v.payload, { apply: true });
  return (await WinterBooklet.findOne({ code: v.payload.code }))!._id.toString();
}

describe("permissions", () => {
  it("refuses Office and a Teacher without the grant everywhere", async () => {
    const bid = await load();
    for (const who of [office, teacher]) {
      await expect(listWinterBooklets(who)).rejects.toThrow();
      await expect(getWinterBooklet(who, bid)).rejects.toThrow();
      await expect(winterChanges(who, bid)).rejects.toThrow();
      await expect(suggestWinterChange(who, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "x" })).rejects.toThrow();
    }
  });

  it("a reviewer cannot accept, set a status or export; the Principal can", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "এক যোগ দুই = {box}" });
    await expect(decideWinterChange(reviewer, ch.id, true)).rejects.toThrow();
    await expect(setWinterBookletStatus(reviewer, bid, "APPROVED")).rejects.toThrow();
    await expect(exportAcceptedWinterBooklet(reviewer, bid)).rejects.toThrow();
    const done = await decideWinterChange(principal, ch.id, true);
    expect(done.status).toBe("ACCEPTED");
    expect((await setWinterBookletStatus(principal, bid, "APPROVED")).status).toBe("APPROVED");
    await expect(setWinterBookletStatus(principal, bid, "NOPE")).rejects.toThrow(WINTER_ERRORS_BN.badStatus);
  });
});

describe("import", () => {
  it("validates the exported shape", () => {
    expect(validateWinterImport(fixture()).ok).toBe(true);
    const bad = validateWinterImport(fixture({ classLevel: 99, pages: [{ n: 1, kind: "COVER", blocks: [{ id: "a", kind: "x", textBn: "t" }, { id: "a", kind: "text", textBn: "t" }] }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join("|")).toMatch(/classLevel/);
      expect(bad.errors.join("|")).toMatch(/repeated/);
      expect(bad.errors.join("|")).toMatch(/bad kind/);
    }
    expect(validateWinterImport(null).ok).toBe(false);
  });

  it("a dry run writes nothing", async () => {
    const v = validateWinterImport(fixture());
    if (!v.ok) throw new Error("fixture");
    const r = await importWinterBooklet(v.payload, { apply: false });
    expect(r).toMatchObject({ mode: "create", pages: 2, blocks: 4 });
    expect(await WinterBooklet.countDocuments()).toBe(0);
    expect(await Audit.countDocuments({ eventKind: "WINTER_BOOKLET_IMPORTED" })).toBe(0);
  });

  it("a re-import keeps a matching suggestion and marks the others stale", async () => {
    const bid = await load();
    const keep = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "এক যোগ দুই = {box}" });
    const gone = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "নতুন পড়া" });
    const note = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, note: "পাতাটি ভালো" });
    // d1-read text changes; d1-t1 stays; version 2.
    const v = validateWinterImport(
      fixture({
        version: 2,
        pages: [
          { n: 1, kind: "COVER", blocks: [{ id: "c-title", kind: "heading", textBn: "নমুনা শিরোনাম" }] },
          {
            n: 2,
            kind: "DAY",
            blocks: [
              { id: "d1-read", kind: "prompt", textBn: "বদলানো পড়ার লেখা" },
              { id: "d1-t1", kind: "text", textBn: "এক যোগ এক = {box}" },
            ],
          },
        ],
      }),
    );
    if (!v.ok) throw new Error("fixture");
    const dry = await importWinterBooklet(v.payload, { apply: false });
    expect(dry).toMatchObject({ mode: "update", keptChanges: 2, staleChanges: 1 });
    expect((await WinterBooklet.findById(bid))!.version).toBe(1);
    await importWinterBooklet(v.payload, { apply: true });
    expect((await WinterBooklet.findById(bid))!.version).toBe(2);
    const rows = await WinterBookletChange.find({ bookletId: bid });
    const stale = (cid: string) => rows.find((r) => r._id.toString() === cid)!.stale;
    expect(stale(keep.id)).toBe(false);
    expect(stale(note.id)).toBe(false);
    expect(stale(gone.id)).toBe(true);
    await expect(editWinterChange(reviewer, gone.id, { after: "z" })).rejects.toThrow(WINTER_ERRORS_BN.stale);
    await expect(decideWinterChange(principal, gone.id, true)).rejects.toThrow(WINTER_ERRORS_BN.stale);
    // still deletable, still rejectable
    await expect(deleteWinterChange(reviewer, gone.id)).resolves.toBe(true);
    expect(await Audit.countDocuments({ eventKind: "WINTER_BOOKLET_IMPORTED" })).toBe(2);
  });
});

describe("suggestions", () => {
  it("a second tap on the same block edits the person's own open suggestion", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "প্রথম" });
    const b = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "দ্বিতীয়", note: "কেন" });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ after: "দ্বিতীয়", note: "কেন", before: "এক যোগ এক = {box}" });
    expect(await WinterBookletChange.countDocuments({ bookletId: bid })).toBe(1);
    // another reviewer gets her own row
    const c = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "তৃতীয়" });
    expect(c.id).not.toBe(a.id);
  });

  it("refuses an unchanged text, a fixed line, an unknown block or page, an empty note", async () => {
    const bid = await load();
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "এক যোগ এক = {box}" })).rejects.toThrow(WINTER_ERRORS_BN.same);
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t2", after: "x" })).rejects.toThrow(WINTER_ERRORS_BN.blockFixed);
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "nope", after: "x" })).rejects.toThrow(WINTER_ERRORS_BN.blockMissing);
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 9, blockId: "d1-t1", after: "x" })).rejects.toThrow(WINTER_ERRORS_BN.pageMissing);
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, note: "  " })).rejects.toThrow(WINTER_ERRORS_BN.nothingToSave);
  });

  it("an empty text is a suggestion to remove the block's text", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "" });
    expect(ch.after).toBe("");
    await decideWinterChange(principal, ch.id, true);
    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    expect(out.pages[1].blocks.find((b: { id: string }) => b.id === "d1-t1").textBn).toBe("");
  });

  it("a reviewer sees only her own suggestions; the Principal sees all with names", async () => {
    const bid = await load();
    const r1 = await User.collection.insertOne({ name: "Reviewer One", role: "TEACHER" });
    const mine = ctxOf(r1.insertedId.toString(), "TEACHER", ["winter_task:review"]);
    await suggestWinterChange(mine, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "খ" });
    const seen = await winterChanges(mine, bid);
    expect(seen).toHaveLength(1);
    expect(seen[0].mine).toBe(true);
    const all = await winterChanges(principal, bid, 2);
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.mine === false && c.byName === "Reviewer One")).toBeDefined();
    const rows = await listWinterBooklets(mine);
    expect(rows[0]).toMatchObject({ code: "T9-2026", openChanges: 1, pageCount: 2, classLabelBn: "তৃতীয় শ্রেণি" });
    expect((await listWinterBooklets(principal))[0].openChanges).toBe(2);
  });
});

describe("own open suggestions only", () => {
  it("edit and delete touch only the person's own OPEN suggestion", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    await expect(editWinterChange(reviewer2, ch.id, { after: "খ" })).rejects.toThrow(WINTER_ERRORS_BN.notOwn);
    await expect(deleteWinterChange(reviewer2, ch.id)).rejects.toThrow(WINTER_ERRORS_BN.notOwn);
    const edited = await editWinterChange(reviewer, ch.id, { after: "গ" });
    expect(edited).toMatchObject({ after: "গ" });
    expect(edited.editedAt).not.toBeNull();
    await decideWinterChange(principal, ch.id, true);
    await expect(editWinterChange(reviewer, ch.id, { after: "ঘ" })).rejects.toThrow(WINTER_ERRORS_BN.notOpen);
    await expect(deleteWinterChange(reviewer, ch.id)).rejects.toThrow(WINTER_ERRORS_BN.notOpen);
    const other = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "ঙ" });
    await expect(deleteWinterChange(reviewer, other.id)).resolves.toBe(true);
    expect((await winterChanges(reviewer, bid)).map((c) => c.id)).not.toContain(other.id);
  });

  it("edits a page note", async () => {
    const bid = await load();
    const n = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 1, note: "এক" });
    const e = await editWinterChange(reviewer, n.id, { note: "দুই" });
    expect(e.note).toBe("দুই");
    expect(e.blockId).toBeNull();
    await expect(editWinterChange(reviewer, n.id, { note: " " })).rejects.toThrow(WINTER_ERRORS_BN.nothingToSave);
  });
});

describe("accept / reject and export", () => {
  it("accept applies `after` to the accepted text and the export; reject does not", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "এক যোগ দুই = {box}" });
    const r = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "অন্য লেখা" });
    await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, note: "পাতার মন্তব্য" });
    await decideWinterChange(principal, a.id, true);
    await decideWinterChange(principal, r.id, false);
    await expect(decideWinterChange(principal, a.id, false)).rejects.toThrow(WINTER_ERRORS_BN.notOpen);

    const detail = await getWinterBooklet(reviewer, bid);
    const blocks = (JSON.parse(detail.pagesJson)[1] as { blocks: Array<{ id: string; textBn: string; acceptedBn?: string }> }).blocks;
    expect(blocks.find((b) => b.id === "d1-t1")).toMatchObject({ textBn: "এক যোগ এক = {box}", acceptedBn: "এক যোগ দুই = {box}" });
    expect(blocks.find((b) => b.id === "d1-read")!.acceptedBn).toBeUndefined();

    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    const day = out.pages[1].blocks as Array<{ id: string; textBn: string }>;
    expect(day.find((b) => b.id === "d1-t1")!.textBn).toBe("এক যোগ দুই = {box}");
    expect(day.find((b) => b.id === "d1-read")!.textBn).toBe("নমুনা পড়ার লেখা");
    expect(out.acceptedChanges).toHaveLength(1);
    expect(out.pageNotes).toHaveLength(1);

    const rows = await listWinterBooklets(principal);
    expect(rows[0]).toMatchObject({ acceptedChanges: 1, openChanges: 1 });
  });

  it("the newest accepted change on a block wins", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "প্রথম" });
    await decideWinterChange(principal, a.id, true);
    const b = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "পরের" });
    await decideWinterChange(principal, b.id, true);
    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    expect(out.pages[1].blocks.find((x: { id: string }) => x.id === "d1-t1").textBn).toBe("পরের");
  });
});

describe("audit", () => {
  it("every write leaves an audit row", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    await editWinterChange(reviewer, ch.id, { after: "খ" });
    const ch2 = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "গ" });
    await deleteWinterChange(reviewer, ch2.id);
    await decideWinterChange(principal, ch.id, true);
    await setWinterBookletStatus(principal, bid, "APPROVED");
    const kinds = (await Audit.find({}).lean()).map((a) => a.eventKind);
    for (const k of ["WINTER_BOOKLET_IMPORTED", "WINTER_CHANGE_SUGGESTED", "WINTER_CHANGE_EDITED", "WINTER_CHANGE_DELETED", "WINTER_CHANGE_DECIDED", "WINTER_BOOKLET_STATUS"]) {
      expect(kinds).toContain(k);
    }
  });
});
