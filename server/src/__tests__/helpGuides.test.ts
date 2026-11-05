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
    { ...guide("d-draft", { perms: ["homework:declare"] }), draft: true, rows: [{ heading: "ধাপ", shot: null, size: null, steps: [{ text: "খসড়া", box: null }] }] },
    guide("bad", { perms: ["nope:nothing"] }),
  ];
  for (const g of guides) {
    fs.writeFileSync(path.join(d, "guides", `${g.id}.json`), JSON.stringify(g));
    if (g.rows[0].shot) {
      fs.mkdirSync(path.join(d, "shots", g.id), { recursive: true });
      fs.writeFileSync(path.join(d, "shots", g.rows[0].shot), "png");
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
  await Promise.all([HelpGuideSeen.deleteMany({}), HelpGuideFeedback.deleteMany({})]);
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

describe("screenshots", () => {
  it("serves only a listed picture of a guide the caller can see", () => {
    const teacher = auth("TEACHER");
    expect(shotPathFor(teacher, "t-declare", "1.png")).toBe(path.resolve(dir, "shots", "t-declare", "1.png"));
    expect(shotPathFor(teacher, "t-declare", "2.png")).toBeNull();
    expect(shotPathFor(teacher, "o-approve", "1.png")).toBeNull();
    expect(shotPathFor(teacher, "t-declare", "..%2F..%2Fcategories.json")).toBeNull();
    expect(shotPathFor(auth("OFFICE"), "o-approve", "1.png")).not.toBeNull();
  });

  it("the route refuses a request with no login", async () => {
    const app = express().use("/files/help", helpShotsRouter);
    await request(app).get("/files/help/t-declare/1.png").expect(403);
  });
});
