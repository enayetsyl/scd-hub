/**
 * AL-14 - the dev-site clock: pure offset Date, install refusals, script maths, query shape off, app helper + gating.
 * No database, no network.
 */
import { readFileSync } from "fs";
import path from "path";
import { makeOffsetDate } from "../lib/devClockOffset";
import { installDevClock, uninstallDevClock, devClockState } from "../lib/devClockInstall";
import { offsetForSet, offsetAdvanced, assertForwardOnly } from "../lib/devClockMath";
import { dhakaDayKey } from "../lib/dhakaDay";

// require(), not import: the app folder is outside the server tsconfig rootDir (TS6059), like navGroups.test.ts.
type Info = { active: boolean; todayKey: string | null; offsetMs: number | null };
const appClock = require("../../../app/src/lib/devClock") as {
  applyDevClock: (i: Info | null, t?: { Date: DateConstructor }) => void;
  getDevClockInfo: () => Info;
  resetDevClockForTests: (t?: { Date: DateConstructor }) => void;
  devClockBannerText: (k: string | null, l: "bn" | "en") => string | null;
};

const DAY = 86_400_000;
const REPO = path.resolve(__dirname, "../../..");

describe("makeOffsetDate", () => {
  it("shifts no-arg construction, Date.now and Date(), nothing else", () => {
    let off = 3 * DAY;
    const D = makeOffsetDate(Date, () => off);
    const real = Date.now();
    expect(Math.abs(new D().getTime() - (real + 3 * DAY))).toBeLessThan(2000);
    expect(Math.abs(D.now() - (real + 3 * DAY))).toBeLessThan(2000);
    expect(new D(0).getTime()).toBe(0);
    expect(new D("2027-02-28T00:00:00Z").toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(new D(2027, 1, 28).getFullYear()).toBe(2027);
    expect(D.parse("2027-01-01T00:00:00Z")).toBe(Date.parse("2027-01-01T00:00:00Z"));
    expect(D.UTC(2027, 0, 1)).toBe(Date.UTC(2027, 0, 1));
    expect(typeof D()).toBe("string");
    off = 0;
    expect(Math.abs(new D().getTime() - Date.now())).toBeLessThan(2000);
  });
  it("keeps instanceof, prototype, JSON and ISO working; picks up an offset change", () => {
    let off = DAY;
    const D = makeOffsetDate(Date, () => off);
    const a = new D();
    expect(a instanceof D).toBe(true);
    expect(a instanceof Date).toBe(true);
    expect(new Date(5) instanceof D).toBe(true); // a real Date (e.g. from a driver) still counts
    expect(Object.getPrototypeOf(a)).toBe(Date.prototype);
    expect(JSON.parse(JSON.stringify({ a })).a).toBe(a.toISOString());
    const t1 = new D().getTime();
    off = 10 * DAY;
    expect(new D().getTime() - t1).toBeGreaterThan(8.9 * DAY);
    class Sub extends D {}
    expect(new Sub() instanceof Date).toBe(true);
  });
});

describe("installDevClock refusals", () => {
  const target = () => ({ Date: Date as DateConstructor });
  afterEach(() => uninstallDevClock(target()));

  it("env missing -> no DB read, no patch", async () => {
    const read = jest.fn(async () => DAY);
    const t = target();
    const r = await installDevClock({ env: {}, dbName: "scdhub_dev", readOffset: read, target: t });
    expect(r).toEqual({ installed: false, reason: "env_missing" });
    expect(read).not.toHaveBeenCalled();
    expect(t.Date).toBe(Date);
    expect(devClockState().active).toBe(false);
  });
  it("env set to something other than 1 -> refused too", async () => {
    const read = jest.fn(async () => DAY);
    const r = await installDevClock({ env: { DEV_CLOCK_ALLOWED: "true" }, dbName: "scdhub_dev", readOffset: read, target: target() });
    expect(r.installed).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("db name not _dev -> refused, no read, no patch", async () => {
    const read = jest.fn(async () => DAY);
    const t = target();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const dbName of ["scdhub", "scdhub_prod", null]) {
      const r = await installDevClock({ env: { DEV_CLOCK_ALLOWED: "1" }, dbName, readOffset: read, target: t });
      expect(r).toEqual({ installed: false, reason: "not_dev_db" });
    }
    expect(read).not.toHaveBeenCalled();
    expect(t.Date).toBe(Date);
    jest.restoreAllMocks();
  });
  it("allowed + _dev -> patches, state is active, uninstall restores", async () => {
    const t = { Date: Date as DateConstructor };
    const lines: string[] = [];
    const r = await installDevClock({ env: { DEV_CLOCK_ALLOWED: "1" }, dbName: "scdhub_dev", readOffset: async () => 30 * DAY, target: t, log: (l) => lines.push(l) });
    expect(r.installed).toBe(true);
    expect(t.Date).not.toBe(Date);
    expect(new t.Date().getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect(devClockState()).toMatchObject({ active: true });
    expect(lines[0]).toMatch(/^\[dev-clock\] ON today=\d{4}-\d{2}-\d{2} offsetDays=30$/);
    uninstallDevClock(t);
    expect(t.Date).toBe(Date);
  });
  it("offset 0 -> installed but state inactive (query shape off)", async () => {
    const t = { Date: Date as DateConstructor };
    await installDevClock({ env: { DEV_CLOCK_ALLOWED: "1" }, dbName: "x_dev", readOffset: async () => 0, target: t, log: () => undefined });
    expect(devClockState()).toEqual({ active: false, todayKey: null, offsetMs: null });
    uninstallDevClock(t);
  });
  it("devClock state is off by default (the public query answer on prod)", () => {
    expect(devClockState()).toEqual({ active: false, todayKey: null, offsetMs: null });
  });
});

describe("script maths (Dhaka day boundaries)", () => {
  it("set: the same Dhaka time-of-day on the target day", () => {
    const realNow = new Date("2026-11-23T10:15:30+06:00");
    const off = offsetForSet("2027-02-28", realNow);
    const shifted = new Date(realNow.getTime() + off);
    expect(dhakaDayKey(shifted)).toBe("2027-02-28");
    expect(shifted.toISOString()).toBe("2027-02-28T04:15:30.000Z");
  });
  it("set --time wins; late-evening and just-after-midnight stay on the right Dhaka day", () => {
    const realNow = new Date("2026-11-23T23:50:00+06:00");
    const a = new Date(realNow.getTime() + offsetForSet("2027-03-01", realNow, "00:05"));
    expect(a.toISOString()).toBe("2027-02-28T18:05:00.000Z"); // 00:05 Dhaka on 1 Mar
    expect(dhakaDayKey(a)).toBe("2027-03-01");
    const b = new Date(realNow.getTime() + offsetForSet("2027-03-01", realNow));
    expect(dhakaDayKey(b)).toBe("2027-03-01");
  });
  it("advance adds whole days; bad input throws", () => {
    expect(offsetAdvanced(2 * DAY, 3)).toBe(5 * DAY);
    expect(offsetAdvanced(5 * DAY, -2)).toBe(3 * DAY);
    expect(() => offsetAdvanced(0, 1.5)).toThrow();
    expect(() => offsetForSet("28-02-2027", new Date())).toThrow();
    expect(() => offsetForSet("2027-02-30", new Date())).toThrow();
    expect(() => offsetForSet("2027-02-28", new Date(), "25:00")).toThrow();
  });
});

describe("no backward moves", () => {
  it("refuses a negative advance and a set to an earlier day; allows same/later", () => {
    expect(() => assertForwardOnly("advance", "2027-02-28", "-1")).toThrow(/backwards/);
    expect(() => assertForwardOnly("set", "2027-02-28", "2027-02-27")).toThrow(/backwards/);
    expect(() => assertForwardOnly("set", "2027-02-28", "2027-02-28")).not.toThrow();
    expect(() => assertForwardOnly("set", "2027-02-28", "2027-03-02")).not.toThrow();
    expect(() => assertForwardOnly("advance", "2027-02-28", "3")).not.toThrow();
  });
  it("the script wires the guard and clears loginthrottles on off", () => {
    const s = readFileSync(path.join(REPO, "server/scripts/dev-clock.ts"), "utf8");
    expect(s).toMatch(/assertForwardOnly\(/);
    expect(s).toMatch(/loginthrottles/);
  });
});

describe("app helper", () => {
  it("is a byte-for-byte twin of the server's offset Date", () => {
    const grab = (f: string) => {
      const s = readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
      const at = s.indexOf("export function makeOffsetDate");
      return s.slice(at, s.indexOf("\n}\n", at) + 3);
    };
    expect(grab("app/src/lib/devClock.ts")).toBe(grab("server/src/lib/devClockOffset.ts"));
  });
  it("inactive answers patch nothing; an active one patches once and follows offset changes", () => {
    const t = { Date: Date as DateConstructor };
    appClock.applyDevClock({ active: false, todayKey: null, offsetMs: null }, t);
    appClock.applyDevClock(null, t);
    expect(t.Date).toBe(Date);
    appClock.applyDevClock({ active: true, todayKey: "2027-02-28", offsetMs: 10 * DAY }, t);
    const patched = t.Date;
    expect(patched).not.toBe(Date);
    appClock.applyDevClock({ active: true, todayKey: "2027-03-01", offsetMs: 20 * DAY }, t);
    expect(t.Date).toBe(patched);
    expect(new t.Date().getTime() - Date.now()).toBeGreaterThan(19 * DAY);
    expect(appClock.getDevClockInfo().todayKey).toBe("2027-03-01");
    appClock.applyDevClock({ active: false, todayKey: null, offsetMs: null }, t);
    expect(Math.abs(new t.Date().getTime() - Date.now())).toBeLessThan(2000);
    appClock.resetDevClockForTests(t);
    expect(t.Date).toBe(Date);
  });
  it("banner text in Bangla and English; null for a bad key", () => {
    expect(appClock.devClockBannerText("2027-02-28", "bn")).toBe("ডেভ ঘড়ি: ২৮ ফেব্রুয়ারি ২০২৭ — পরীক্ষার সাইট");
    expect(appClock.devClockBannerText("2027-02-28", "en")).toBe("Dev clock: 28 Feb 2027 - test site");
    expect(appClock.devClockBannerText(null, "en")).toBeNull();
  });
  it("gating by source scan: the root checks before mount; the banner renders null unless active; API boot is guarded", () => {
    const app = readFileSync(path.join(REPO, "app/App.tsx"), "utf8");
    expect(app).toMatch(/checkDevClock\(\)/);
    expect(app).toMatch(/!fontsLoaded \|\| !clockChecked/);
    expect(app).toMatch(/React\.useState\(!DEV_CLOCK_BUILD\)/);
    expect(app).toMatch(/if \(DEV_CLOCK_BUILD && !clockChecked\) return;[\s\S]*hideAsync/);
    expect(app).toMatch(/<DevClockBanner \/>/);
    const banner = readFileSync(path.join(REPO, "app/src/components/DevClockBanner.tsx"), "utf8");
    expect(banner).toMatch(/if \(!DEV_CLOCK_BUILD \|\| !info\.active\) return null;/);
    // AL-14 build flag: every query / interval / patch path is behind it.
    expect(banner).toMatch(/export const DEV_CLOCK_BUILD = process\.env\.EXPO_PUBLIC_DEV_CLOCK === "1";/);
    expect(banner).toMatch(/export async function checkDevClock[^{]*\{\s*if \(!DEV_CLOCK_BUILD\) return;/);
    expect(banner).toMatch(/if \(!DEV_CLOCK_BUILD\) return undefined;[\s\S]*setInterval/);
    expect(banner.match(/applyDevClock\(/g)?.length).toBe(1);
    expect(banner.match(/setInterval\(/g)?.length).toBe(1);
    expect(banner).toMatch(/clearTimeout/);
    const lib = readFileSync(path.join(REPO, "app/src/lib/devClock.ts"), "utf8");
    expect(lib).not.toMatch(/^import /m);
    const idx = readFileSync(path.join(REPO, "server/src/index.ts"), "utf8");
    expect(idx.indexOf("await connectDb();")).toBeLessThan(idx.indexOf("await installDevClock();"));
    const inst = readFileSync(path.join(REPO, "server/src/lib/devClockInstall.ts"), "utf8");
    expect(inst).toMatch(/DEV_CLOCK_ALLOWED !== "1"/);
    expect(inst).toMatch(/endsWith\("_dev"\)/);
  });
});
