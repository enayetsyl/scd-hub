/**
 * prd-help-centre HC-1 (D-#968–#972) — in-app help guides.
 *
 *   check      the shared structural check: markup, step limit, boxes, one of perms/audience,
 *              id = file name, unknown permission, drafts may lack shots
 *   visible    teacher / office / guardian each see only their own guides; drafts and broken
 *              files never; grant → appears, revoke → gone; categories follow the guides
 *   নতুন       nothing new on the first open; a guide unlocked later is new until opened;
 *              opening one from a screen's ? before the home still sets the baseline
 *   view-as    reads the borrowed set, never writes the seen-list or feedback
 *   feedback   one answer per person per guide, changeable
 *   shots      only a listed picture of a visible guide; the route refuses no login
 *   feature    a guardian guide naming a released feature (D-#1011) shows only once it is on for them
 *   read       a reading guide (kind "read", D-#1280): sections/blocks check, served with sections, no rows
 *
 * In-memory MongoDB, real services, a fixture help folder in the OS temp dir.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { catalogueAction, checkHelpGuide, helpPermissionKeys, type HelpGuideFile } from "@scd/shared";
import type { AppContext, AuthPayload } from "../context";
import { HelpGuideSeen } from "../modules/help/models/HelpGuideSeen";
import { HelpGuideFeedback } from "../modules/help/models/HelpGuideFeedback";
import {
  markHelpGuideRead,
  markHelpOpened,
  myHelpGuides,
  recordHelpFeedback,
  setHelpDirForTests,
  shotPathFor,
} from "../modules/help/services/HelpGuideService";
import { helpShotsRouter } from "../modules/help/routes/helpShots";
import { GuardianFeatureAccess } from "../modules/guardian-access/models/GuardianFeatureAccess";

let mongo: MongoMemoryServer;
let dir: string;

const guide = (id: string, who: Partial<HelpGuideFile>, extra: Partial<HelpGuideFile> = {}): HelpGuideFile => ({
  id,
  category: "homework_assignment",
  title: `শিরোনাম ${id}`,
  intro: "ভূমিকা",
  keywords: ["শব্দ"],
  ...who,
  rows: [
    {
      heading: "ধাপ",
      shot: `${id}/1.png`,
      size: [1080, 2340],
      steps: [
        { text: "<b>মেনু</b> চাপুন।", box: [0.1, 0.2, 0.3, 0.05] },
        { text: "<b>জমা দিন</b> চাপুন।", box: [0.1, 0.8, 0.8, 0.06] },
      ],
    },
  ],
  ...extra,
});

/** A reading guide (D-#1280): text sections, no rows. */
const readGuide = (id: string, extra: Partial<HelpGuideFile> = {}): HelpGuideFile => ({
  id,
  kind: "read",
  category: "homework_assignment",
  title: `পড়ার নির্দেশিকা ${id}`,
  intro: "ভূমিকা",
  keywords: ["নির্দেশিকা"],
  perms: ["homework:declare"],
  sections: [
    {
      heading: "১. উদ্দেশ্য",
      blocks: [
        { p: "একটি <b>অনুচ্ছেদ</b>।" },
        { list: ["প্রথম", "<b>দ্বিতীয়</b>"] },
        { table: { head: ["তথ্য", "কী দেখবেন"], rows: [["<b>সংখ্যা</b>", "উপস্থিতি"], ["সারাংশ", "খসড়া"]] } },
        { check: ["যাচাই করা হয়েছে"] },
      ],
    },
  ],
  ...extra,
});

function writeFixture(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "help-"));
  fs.mkdirSync(path.join(d, "guides"));
  fs.writeFileSync(
    path.join(d, "categories.json"),
    JSON.stringify([
      { id: "attendance_leave", title: "উপস্থিতি ও ছুটি" },
      { id: "homework_assignment", title: "বাড়ির কাজ ও অ্যাসাইনমেন্ট" },
      { id: "child", title: "সন্তানের খোঁজখবর" },
      { id: "unused", title: "খালি" },
    ]),
  );
  const guides: HelpGuideFile[] = [
    guide("t-declare", { perms: ["homework:declare"] }, { screens: ["HomeworkTab/HomeworkHome"], goTo: { route: "HomeworkTab" } }),
    guide("o-approve", { perms: ["leave:approve"] }, { category: "attendance_leave", order: 1 }),
    guide("all-leave", { audience: "ALL_STAFF" }, { category: "attendance_leave" }),
    guide("g-hw", { audience: "GUARDIAN" }, { category: "child" }),
    guide("g-story", { audience: "GUARDIAN" }, { category: "child", guardianFeature: "STORYBOOKS" }),
    { ...guide("d-draft", { perms: ["homework:declare"] }), draft: true, rows: [{ heading: "ধাপ", shot: null, size: null, steps: [{ text: "খসড়া", box: null }] }] },
    guide("bad", { perms: ["nope:nothing"] }),
  ];
  for (const g of guides) {
    fs.writeFileSync(path.join(d, "guides", `${g.id}.json`), JSON.stringify(g));
    const shot = g.rows?.[0]?.shot;
    if (shot) {
      fs.mkdirSync(path.join(d, "shots", g.id), { recursive: true });
      fs.writeFileSync(path.join(d, "shots", shot), "png");
    }
  }
  fs.writeFileSync(path.join(d, "shots", "t-declare", "2.png"), "not listed");
  return d;
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([HelpGuideSeen.init(), HelpGuideFeedback.init()]);
  dir = writeFixture();
  setHelpDirForTests(dir);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterAll(async () => {
  setHelpDirForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all([HelpGuideSeen.deleteMany({}), HelpGuideFeedback.deleteMany({}), GuardianFeatureAccess.deleteMany({})]);
});

const auth = (role: string, extra: Partial<AuthPayload> = {}): AuthPayload =>
  ({ userId: new Types.ObjectId().toString(), role, ...extra }) as unknown as AuthPayload;
const ctxOf = (a: AuthPayload): AppContext => ({ auth: a }) as unknown as AppContext;
const ids = async (a: AuthPayload) => (await myHelpGuides(ctxOf(a))).guides.map((g) => g.id).sort();

describe("checkHelpGuide (shared)", () => {
  const env = {
    fileId: "t-1",
    categoryIds: new Set(["homework_assignment"]),
    permissionKeys: helpPermissionKeys(),
    shotExists: () => true,
  };
  const ok = guide("t-1", { perms: ["homework:declare"] });

  it("passes a well-formed guide", () => {
    expect(checkHelpGuide(ok, env)).toEqual([]);
  });

  it("names every problem", () => {
    const steps = Array.from({ length: 9 }, () => ({ text: "<b>ক</b>", box: [0, 0, 0.1, 0.1] }));
    const broken = {
      ...ok,
      id: "t-2",
      audience: "ALL_STAFF",
      perms: ["homework:declare", "nope:x"],
      rows: [{ heading: "h", shot: "t-2/1.png", size: [10, 10], steps: [...steps, { text: "<i>x</i>", box: [0.9, 0, 0.2, 0.1] }] }],
    };
    const p = checkHelpGuide(broken, env).join("\n");
    expect(p).toMatch(/must equal the file name/);
    expect(p).toMatch(/exactly one of perms or audience/);
    expect(p).toMatch(/"nope:x" is not in the permission catalogue/);
    expect(p).toMatch(/only <b> is allowed/);
    expect(p).toMatch(/inside the picture/);
    expect(p).toMatch(/10 steps; a guide has at most 8/);
  });

  it("refuses a legacy permission name and a missing shot; a draft may lack shots and boxes", () => {
    expect(checkHelpGuide({ ...ok, perms: ["content:import"] }, env).join()).toMatch(/not in the permission catalogue/);
    expect(checkHelpGuide(ok, { ...env, shotExists: () => false }).join()).toMatch(/shot file t-1\/1.png is missing/);
    const draft = { ...ok, draft: true, rows: [{ heading: "h", shot: null, size: null, steps: [{ text: "ক", box: null }] }] };
    expect(checkHelpGuide(draft, env)).toEqual([]);
    expect(checkHelpGuide({ ...draft, draft: false }, env).length).toBeGreaterThan(0);
  });

  it("a guardianFeature needs a known feature and the GUARDIAN audience (D-#1011)", () => {
    const g = guide("t-1", { audience: "GUARDIAN" });
    expect(checkHelpGuide({ ...g, guardianFeature: "STORYBOOKS" }, env)).toEqual([]);
    expect(checkHelpGuide({ ...g, guardianFeature: "NOPE" }, env).join()).toMatch(/guardianFeature must be one of/);
    expect(checkHelpGuide({ ...ok, guardianFeature: "STORYBOOKS" }, env).join()).toMatch(/needs audience "GUARDIAN"/);
  });
});

describe("reading guides (D-#1280)", () => {
  const env = {
    fileId: "t-read",
    categoryIds: new Set(["homework_assignment"]),
    permissionKeys: helpPermissionKeys(),
    shotExists: () => false,
  };
  const ok = readGuide("t-read");
  const withBlocks = (blocks: unknown[]) => ({ ...ok, sections: [{ heading: "শিরোনাম", blocks }] });
  const problems = (g: unknown) => checkHelpGuide(g, env).join("\n");

  it("passes a well-formed reading guide (no shots needed) and an explicit steps kind", () => {
    expect(checkHelpGuide(ok, env)).toEqual([]);
    const steps = guide("t-1", { perms: ["homework:declare"] }, { kind: "steps" });
    expect(checkHelpGuide(steps, { ...env, fileId: "t-1", shotExists: () => true })).toEqual([]);
  });

  it("refuses an unknown kind, rows on a reading guide, and sections on a steps guide", () => {
    expect(problems({ ...ok, kind: "video" })).toMatch(/kind must be one of steps, read/);
    expect(problems({ ...ok, rows: [] })).toMatch(/has no rows/);
    const steps = guide("t-1", { perms: ["homework:declare"] }, { sections: ok.sections });
    expect(checkHelpGuide(steps, { ...env, fileId: "t-1", shotExists: () => true }).join()).toMatch(/sections need kind "read"/);
  });

  it("needs 1–15 sections, each with a heading and at least one block", () => {
    expect(problems({ ...ok, sections: undefined })).toMatch(/sections: 1–15 sections/);
    expect(problems({ ...ok, sections: [] })).toMatch(/sections: 1–15 sections/);
    expect(problems({ ...ok, sections: Array.from({ length: 16 }, () => ok.sections![0]) })).toMatch(/1–15 sections/);
    expect(problems({ ...ok, sections: [{ heading: "", blocks: [{ p: "ক" }] }] })).toMatch(/sections\[0\]\.heading: text is required/);
    expect(problems({ ...ok, sections: [{ heading: "ক", blocks: [] }] })).toMatch(/at least one block/);
  });

  it("each block is exactly one known type", () => {
    expect(problems(withBlocks([{ p: "ক", list: ["খ"] }]))).toMatch(/exactly one of p, list, table, check/);
    expect(problems(withBlocks([{ quote: "ক" }]))).toMatch(/exactly one of p, list, table, check/);
    expect(problems(withBlocks([{ list: [] }]))).toMatch(/list: a non-empty list of text/);
    expect(problems(withBlocks([{ check: ["ক", ""] }]))).toMatch(/check\[1\]: text is required/);
  });

  it("tables are rectangular and every string passes the <b>-only markup check", () => {
    expect(problems(withBlocks([{ table: { head: ["ক", "খ"], rows: [["১"]] } }]))).toMatch(/1 cells; the head has 2/);
    expect(problems(withBlocks([{ table: { head: ["ক"], rows: [] } }]))).toMatch(/at least one row/);
    expect(problems(withBlocks([{ table: ["ক"] }]))).toMatch(/must be \{ head, rows \}/);
    expect(problems(withBlocks([{ p: "<i>ক</i>" }]))).toMatch(/only <b> is allowed/);
    expect(problems(withBlocks([{ list: ["<b>ক"] }]))).toMatch(/unclosed <b>/);
    expect(problems(withBlocks([{ table: { head: ["<b><b>ক</b></b>"], rows: [["খ"]] } }]))).toMatch(/nested <b>/);
    expect(problems({ ...ok, sections: [{ heading: "ক > খ", blocks: [{ p: "গ" }] }] })).toMatch(/stray < or >/);
  });

  it("is served with its sections and no rows; perms gate it like any guide", async () => {
    // Its own folder (the shared fixture's exact lists stay as they are): the reading guide + one steps guide.
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "help-read-"));
    fs.mkdirSync(path.join(d2, "guides"));
    fs.mkdirSync(path.join(d2, "shots", "t-declare"), { recursive: true });
    fs.writeFileSync(path.join(d2, "categories.json"), JSON.stringify([{ id: "homework_assignment", title: "বাড়ির কাজ" }]));
    fs.writeFileSync(path.join(d2, "guides", "t-read.json"), JSON.stringify(ok));
    fs.writeFileSync(path.join(d2, "guides", "t-declare.json"), JSON.stringify(guide("t-declare", { perms: ["homework:declare"] })));
    fs.writeFileSync(path.join(d2, "shots", "t-declare", "1.png"), "png");
    setHelpDirForTests(d2);
    try {
      await servedChecks();
    } finally {
      setHelpDirForTests(dir);
      fs.rmSync(d2, { recursive: true, force: true });
    }
  });

  async function servedChecks(): Promise<void> {
    const h = await myHelpGuides(ctxOf(auth("TEACHER")));
    const r = h.guides.find((g) => g.id === "t-read")!;
    expect(r.kind).toBe("read");
    expect(r.rows).toEqual([]);
    expect(r.sections[0].heading).toBe("১. উদ্দেশ্য");
    expect(r.sections[0].blocks).toEqual([
      { p: "একটি <b>অনুচ্ছেদ</b>।", list: null, check: null, tableHead: null, tableRows: null },
      { p: null, list: ["প্রথম", "<b>দ্বিতীয়</b>"], check: null, tableHead: null, tableRows: null },
      { p: null, list: null, check: null, tableHead: ["তথ্য", "কী দেখবেন"], tableRows: [["<b>সংখ্যা</b>", "উপস্থিতি"], ["সারাংশ", "খসড়া"]] },
      { p: null, list: null, check: ["যাচাই করা হয়েছে"], tableHead: null, tableRows: null },
    ]);
    expect(h.guides.find((g) => g.id === "t-declare")).toMatchObject({ kind: "steps", sections: [] });
    expect(await ids(auth("TEACHER", { revokedPermissions: ["homework:declare"] } as Partial<AuthPayload>))).not.toContain("t-read");
    expect(await shotPathFor(auth("TEACHER"), "t-read", "1.png")).toBeNull();
  }
});

describe("who sees which guide (D-#969)", () => {
  it("a teacher sees own-permission and everyone guides, never office, guardian, draft or broken ones", async () => {
    expect(await ids(auth("TEACHER"))).toEqual(["all-leave", "t-declare"]);
  });

  it("follows grants and revocations", async () => {
    expect(await ids(auth("TEACHER", { grantedPermissions: ["leave:approve"] } as Partial<AuthPayload>))).toEqual([
      "all-leave",
      "o-approve",
      "t-declare",
    ]);
    expect(await ids(auth("TEACHER", { revokedPermissions: ["homework:declare"] } as Partial<AuthPayload>))).toEqual([
      "all-leave",
    ]);
  });

  it("office and guardian get their own sets; the Principal every staff guide", async () => {
    expect(await ids(auth("OFFICE"))).toContain("o-approve");
    expect(await ids(auth("GUARDIAN"))).toEqual(["g-hw"]);
    expect(await ids(auth("PRINCIPAL"))).toEqual(["all-leave", "o-approve", "t-declare"]);
  });

  it("orders guides by category, then the guide's own order, then title", async () => {
    // o-approve has order 1; all-leave has none (last), so it follows despite sorting first by title.
    expect(await ids(auth("PRINCIPAL"))).toEqual(["all-leave", "o-approve", "t-declare"]);
    expect((await myHelpGuides(ctxOf(auth("PRINCIPAL")))).guides.map((g) => g.id)).toEqual(["o-approve", "all-leave", "t-declare"]);
    expect(checkHelpGuide({ ...guide("t-1", { perms: ["homework:declare"] }), order: 1.5 }, { fileId: "t-1", categoryIds: new Set(["homework_assignment"]), permissionKeys: helpPermissionKeys(), shotExists: () => true }).join()).toMatch(/order must be a whole number/);
  });

  it("returns only the categories in use, in file order, and the why-line", async () => {
    const h = await myHelpGuides(ctxOf(auth("TEACHER")));
    expect(h.categories.map((c) => c.id)).toEqual(["attendance_leave", "homework_assignment"]);
    const t = h.guides.find((g) => g.id === "t-declare")!;
    expect(t.unlockedBy).toBe(catalogueAction("homework:declare").bn);
    expect(t).toMatchObject({ screens: ["HomeworkTab/HomeworkHome"], goToRoute: "HomeworkTab", goToScreen: null });
    expect(t.rows[0]).toMatchObject({ shotUrl: "/files/help/t-declare/1.png", width: 1080, height: 2340 });
    expect(t.rows[0].steps[1].box).toEqual([0.1, 0.8, 0.8, 0.06]);
    expect(h.guides.find((g) => g.id === "all-leave")!.unlockedBy).toBeNull();
  });
});

describe("নতুন badge (D-#972)", () => {
  it("nothing is new on the first open; a later-unlocked guide is new until opened", async () => {
    const userId = new Types.ObjectId().toString();
    const before = auth("TEACHER", { userId } as Partial<AuthPayload>);
    const first = await myHelpGuides(ctxOf(before));
    expect(first.firstOpen).toBe(true);
    expect(first.guides.every((g) => !g.isNew)).toBe(true);
    expect(await markHelpOpened(ctxOf(before))).toBe(true);

    const granted = auth("TEACHER", { userId, grantedPermissions: ["leave:approve"] } as Partial<AuthPayload>);
    const later = await myHelpGuides(ctxOf(granted));
    expect(later.firstOpen).toBe(false);
    expect(later.guides.filter((g) => g.isNew).map((g) => g.id)).toEqual(["o-approve"]);

    expect(await markHelpGuideRead(ctxOf(granted), "o-approve")).toBe(true);
    expect((await myHelpGuides(ctxOf(granted))).guides.some((g) => g.isNew)).toBe(false);
  });

  it("opening a guide from a screen's ? before the home sets the baseline too", async () => {
    const a = auth("TEACHER");
    expect(await markHelpGuideRead(ctxOf(a), "t-declare")).toBe(true);
    const h = await myHelpGuides(ctxOf(a));
    expect(h.firstOpen).toBe(false);
    expect(h.guides.some((g) => g.isNew)).toBe(false);
  });

  it("refuses a guide the caller cannot see", async () => {
    expect(await markHelpGuideRead(ctxOf(auth("TEACHER")), "o-approve")).toBe(false);
    expect(await markHelpGuideRead(ctxOf(auth("TEACHER")), "d-draft")).toBe(false);
    expect(await HelpGuideSeen.countDocuments()).toBe(0);
  });
});

describe("View-as (D-#638)", () => {
  it("reads the borrowed set but writes nothing", async () => {
    const borrowed = auth("GUARDIAN", { impersonatorId: new Types.ObjectId().toString() } as Partial<AuthPayload>);
    expect(await ids(borrowed)).toEqual(["g-hw"]);
    expect(await markHelpOpened(ctxOf(borrowed))).toBe(false);
    expect(await markHelpGuideRead(ctxOf(borrowed), "g-hw")).toBe(false);
    expect(await recordHelpFeedback(ctxOf(borrowed), "g-hw", true)).toBe(false);
    expect(await HelpGuideSeen.countDocuments()).toBe(0);
    expect(await HelpGuideFeedback.countDocuments()).toBe(0);
  });
});

describe("feedback", () => {
  it("keeps one changeable answer per person per guide", async () => {
    const a = auth("TEACHER");
    expect(await recordHelpFeedback(ctxOf(a), "t-declare", true)).toBe(true);
    expect(await recordHelpFeedback(ctxOf(a), "t-declare", false)).toBe(true);
    const rows = await HelpGuideFeedback.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ guideId: "t-declare", helpful: false, ownerKind: "USER" });
    expect(await recordHelpFeedback(ctxOf(a), "o-approve", true)).toBe(false);
  });
});

describe("guardian feature guides (D-#1011)", () => {
  it("stay hidden until the feature is on for that guardian, for one or for all", async () => {
    const a = auth("GUARDIAN");
    const b = auth("GUARDIAN");
    expect(await ids(a)).toEqual(["g-hw"]);
    expect(await shotPathFor(a, "g-story", "1.png")).toBeNull();
    await GuardianFeatureAccess.create({ feature: "STORYBOOKS", onForAll: false, guardianIds: [new Types.ObjectId(a.userId)] });
    expect(await ids(a)).toEqual(["g-hw", "g-story"]);
    expect(await shotPathFor(a, "g-story", "1.png")).not.toBeNull();
    expect(await ids(b)).toEqual(["g-hw"]);
    await GuardianFeatureAccess.updateOne({ feature: "STORYBOOKS" }, { onForAll: true });
    expect(await ids(b)).toEqual(["g-hw", "g-story"]);
    expect(await ids(auth("PRINCIPAL"))).not.toContain("g-story");
  });
});

describe("screenshots", () => {
  it("serves only a listed picture of a guide the caller can see", async () => {
    const teacher = auth("TEACHER");
    expect(await shotPathFor(teacher, "t-declare", "1.png")).toBe(path.resolve(dir, "shots", "t-declare", "1.png"));
    expect(await shotPathFor(teacher, "t-declare", "2.png")).toBeNull();
    expect(await shotPathFor(teacher, "o-approve", "1.png")).toBeNull();
    expect(await shotPathFor(teacher, "t-declare", "..%2F..%2Fcategories.json")).toBeNull();
    expect(await shotPathFor(auth("OFFICE"), "o-approve", "1.png")).not.toBeNull();
  });

  it("the route refuses a request with no login", async () => {
    const app = express().use("/files/help", helpShotsRouter);
    await request(app).get("/files/help/t-declare/1.png").expect(403);
  });
});
