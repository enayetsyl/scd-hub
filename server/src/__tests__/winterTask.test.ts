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

/** The Principal decides on what is on screen: the suggestion's current editedAt ("" = never edited). */
async function decide(changeId: string, accept: boolean) {
  const c = await WinterBookletChange.findById(changeId);
  return decideWinterChange(principal, changeId, accept, c?.editedAt ? c.editedAt.toISOString() : "");
}
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
    await expect(decideWinterChange(reviewer, ch.id, true, "")).rejects.toThrow();
    await expect(setWinterBookletStatus(reviewer, bid, "APPROVED")).rejects.toThrow();
    await expect(exportAcceptedWinterBooklet(reviewer, bid)).rejects.toThrow();
    const done = await decide(ch.id, true);
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
    await expect(decideWinterChange(principal, gone.id, true, "")).rejects.toThrow(WINTER_ERRORS_BN.stale);
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
    await decide(ch.id, true);
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
    await decide(ch.id, true);
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
    await decide(a.id, true);
    await decide(r.id, false);
    await expect(decideWinterChange(principal, a.id, false, "")).rejects.toThrow(WINTER_ERRORS_BN.notOpen);

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
    await decide(a.id, true);
    const b = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "পরের" });
    await decide(b.id, true);
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
    await decide(ch.id, true);
    await setWinterBookletStatus(principal, bid, "APPROVED");
    const kinds = (await Audit.find({}).lean()).map((a) => a.eventKind);
    for (const k of ["WINTER_BOOKLET_IMPORTED", "WINTER_CHANGE_SUGGESTED", "WINTER_CHANGE_EDITED", "WINTER_CHANGE_DELETED", "WINTER_CHANGE_DECIDED", "WINTER_BOOKLET_STATUS"]) {
      expect(kinds).toContain(k);
    }
  });
});

describe("chained suggestions", () => {
  it("a later suggestion starts from the accepted text and never drops the earlier acceptance", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "পরিবর্তন এক" });
    await decide(a.id, true);
    const b = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "পরিবর্তন দুই" });
    expect(b.before).toBe("পরিবর্তন এক");
    // the same text as the accepted one is "no change"
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "পরিবর্তন এক" })).rejects.toThrow(WINTER_ERRORS_BN.same);
    await decide(b.id, true);
    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    expect(out.pages[1].blocks.find((x: { id: string }) => x.id === "d1-t1").textBn).toBe("পরিবর্তন দুই");
    expect(out.acceptedChanges.map((c: { after: string }) => c.after)).toEqual(["পরিবর্তন এক", "পরিবর্তন দুই"]);
  });

  it("accepting one of two suggestions built on the same text makes the other stale and unacceptable", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    const b = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "খ" });
    await decide(a.id, true);
    expect((await WinterBookletChange.findById(b.id))!.stale).toBe(true);
    await expect(decideWinterChange(principal, b.id, true, "")).rejects.toThrow(WINTER_ERRORS_BN.stale);
    await expect(decideWinterChange(principal, b.id, false, "")).resolves.toMatchObject({ status: "REJECTED" });
  });
});

describe("races", () => {
  it("accept refuses when the reviewer edited the suggestion after the Principal saw it", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "প্রথম" });
    await editWinterChange(reviewer, ch.id, { after: "বদলানো" });
    await expect(decideWinterChange(principal, ch.id, true, "")).rejects.toThrow(WINTER_ERRORS_BN.changed);
    expect((await WinterBookletChange.findById(ch.id))!.status).toBe("OPEN");
  });

  it("a deleted suggestion cannot be deleted again or accepted", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    await expect(deleteWinterChange(reviewer, ch.id)).resolves.toBe(true);
    await expect(deleteWinterChange(reviewer, ch.id)).rejects.toThrow(WINTER_ERRORS_BN.notOpen);
    await expect(decideWinterChange(principal, ch.id, true, "")).rejects.toThrow(WINTER_ERRORS_BN.notOpen);
  });

  it("accept checks the block's CURRENT text, not only the stale flag", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    // an import changed the text but the stale flag has not caught up yet
    await WinterBooklet.updateOne({ _id: bid, "pages.n": 2 }, { $set: { "pages.$.blocks.1.textBn": "নতুন মূল লেখা" } });
    await expect(decideWinterChange(principal, ch.id, true, "")).rejects.toThrow(WINTER_ERRORS_BN.stale);
    expect((await WinterBookletChange.findById(ch.id))!.stale).toBe(true);
  });

  it("a double tap cannot leave two live open suggestions on one block (partial unique index)", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    const row = (await WinterBookletChange.findById(ch.id))!;
    await expect(
      WinterBookletChange.collection.insertOne({ bookletId: row.bookletId, pageN: 2, blockId: "d1-t1", before: "x", after: "y", by: row.by, status: "OPEN", stale: false }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("APPROVED locks the booklet", () => {
  it("refuses suggest / edit / delete / decide until the Principal reopens it", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "ক" });
    await setWinterBookletStatus(principal, bid, "APPROVED");
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "খ" })).rejects.toThrow(WINTER_ERRORS_BN.approvedLocked);
    await expect(suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, note: "মন্তব্য" })).rejects.toThrow(WINTER_ERRORS_BN.approvedLocked);
    await expect(editWinterChange(reviewer, ch.id, { after: "গ" })).rejects.toThrow(WINTER_ERRORS_BN.approvedLocked);
    await expect(deleteWinterChange(reviewer, ch.id)).rejects.toThrow(WINTER_ERRORS_BN.approvedLocked);
    await expect(decide(ch.id, true)).rejects.toThrow(WINTER_ERRORS_BN.approvedLocked);
    await setWinterBookletStatus(principal, bid, "IN_REVIEW");
    await expect(decide(ch.id, true)).resolves.toMatchObject({ status: "ACCEPTED" });
  });

  it("a re-import that changes a text resets the status; one that changes nothing keeps it", async () => {
    const bid = await load();
    await setWinterBookletStatus(principal, bid, "APPROVED");
    const same = validateWinterImport(fixture({ version: 2 }));
    if (!same.ok) throw new Error("fixture");
    expect((await importWinterBooklet(same.payload, { apply: true })).statusReset).toBe(false);
    expect((await WinterBooklet.findById(bid))!.status).toBe("APPROVED");
    const changed = validateWinterImport(fixture({ version: 3, pages: [{ n: 1, kind: "COVER", blocks: [{ id: "c-title", kind: "heading", textBn: "অন্য শিরোনাম" }] }] }));
    if (!changed.ok) throw new Error("fixture");
    expect((await importWinterBooklet(changed.payload, { apply: false })).statusReset).toBe(true);
    expect((await WinterBooklet.findById(bid))!.status).toBe("APPROVED");
    await importWinterBooklet(changed.payload, { apply: true });
    expect((await WinterBooklet.findById(bid))!.status).toBe("IN_REVIEW");
  });
});

describe("re-import and accepted suggestions", () => {
  it("separates an accepted change already in the new text from one that is lost, and exports staleAccepted", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "বসানো লেখা" });
    const b = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-read", after: "হারানো লেখা" });
    await decide(a.id, true);
    await decide(b.id, true);
    const v = validateWinterImport(
      fixture({
        version: 2,
        pages: [
          { n: 1, kind: "COVER", blocks: [{ id: "c-title", kind: "heading", textBn: "নমুনা শিরোনাম" }] },
          {
            n: 2,
            kind: "DAY",
            blocks: [
              { id: "d1-read", kind: "prompt", textBn: "সম্পূর্ণ অন্য পড়া" },
              { id: "d1-t1", kind: "text", textBn: "বসানো লেখা" },
            ],
          },
        ],
      }),
    );
    if (!v.ok) throw new Error("fixture");
    const dry = await importWinterBooklet(v.payload, { apply: false });
    expect(dry.absorbedAccepted).toBe(1);
    expect(dry.lostAccepted).toEqual(["d1-read"]);
    await importWinterBooklet(v.payload, { apply: true });
    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    expect(out.staleAccepted.map((c: { blockId: string }) => c.blockId).sort()).toEqual(["d1-read", "d1-t1"]);
    const day = out.pages[1].blocks as Array<{ id: string; textBn: string }>;
    expect(day.find((x) => x.id === "d1-t1")!.textBn).toBe("বসানো লেখা");
    expect(day.find((x) => x.id === "d1-read")!.textBn).toBe("সম্পূর্ণ অন্য পড়া");
  });

  it("an accepted chain survives a re-import that leaves the text unchanged", async () => {
    const bid = await load();
    const a = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "এক" });
    await decide(a.id, true);
    const b = await suggestWinterChange(reviewer2, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "দুই" });
    await decide(b.id, true);
    const v = validateWinterImport(fixture({ version: 2 }));
    if (!v.ok) throw new Error("fixture");
    const r = await importWinterBooklet(v.payload, { apply: true });
    expect(r.lostAccepted).toEqual([]);
    expect(r.staleChanges).toBe(0);
    const out = JSON.parse(await exportAcceptedWinterBooklet(principal, bid));
    expect(out.pages[1].blocks.find((x: { id: string }) => x.id === "d1-t1").textBn).toBe("দুই");
  });
});

describe("import validation limits", () => {
  it("refuses a missing or invalid version, over-long text, bad dateKey / week, and too many pages", () => {
    const noVersion = fixture();
    delete (noVersion as { version?: number }).version;
    expect(validateWinterImport(noVersion).ok).toBe(false);
    expect(validateWinterImport(fixture({ version: 0 })).ok).toBe(false);
    expect(validateWinterImport(fixture({ pages: [{ n: 1, kind: "COVER", blocks: [{ id: "a", kind: "text", textBn: "ক".repeat(2001) }] }] })).ok).toBe(false);
    const badDay = validateWinterImport(fixture({ pages: [{ n: 1, kind: "DAY", dateKey: "12 Dec", week: 0, blocks: [] }] }));
    expect(badDay.ok).toBe(false);
    if (!badDay.ok) expect(badDay.errors.join("|")).toMatch(/dateKey[\s\S]*week/);
    expect(validateWinterImport(fixture({ pages: Array.from({ length: 61 }, (_, i) => ({ n: i + 1, kind: "COVER", blocks: [] })) })).ok).toBe(false);
  });
});

describe("audit meta carries no booklet text", () => {
  it("stores ids and lengths only", async () => {
    const bid = await load();
    const ch = await suggestWinterChange(reviewer, { bookletId: bid, pageN: 2, blockId: "d1-t1", after: "গোপন দীর্ঘ লেখা ".repeat(20) });
    await editWinterChange(reviewer, ch.id, { after: "আরেক দীর্ঘ লেখা ".repeat(20) });
    const rows = await Audit.find({ eventKind: { $in: ["WINTER_CHANGE_SUGGESTED", "WINTER_CHANGE_EDITED"] } }).lean();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(JSON.stringify(r.meta)).not.toMatch(/দীর্ঘ/);
    expect(rows.find((r) => r.eventKind === "WINTER_CHANGE_EDITED")!.meta).toMatchObject({ prevAfterLen: expect.any(Number), afterLen: expect.any(Number) });
  });
});
