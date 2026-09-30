/**
 * The guardian announcement popup (D-#700).
 *
 * The owner asked for a notice that appears "once a day when they open the app
 * for the first time, for 7 days". Three decisions carry it, and each is the one
 * a later reader will want justified:
 *
 *   WINDOW, NOT COUNT   — "7 days" is a pair of dates, not seven showings. A
 *                         per-guardian counter keeps a message alive for weeks
 *                         for someone who opens the app rarely, long after it
 *                         stopped being news, and nothing would ever end it.
 *   SERVER'S DAY        — the row carries `todayKey` in Asia/Dhaka and the client
 *                         compares against THAT. A device clock must not decide
 *                         which day the school is having, and the app must not
 *                         grow a second Dhaka conversion.
 *   DATA, NOT A BANNER  — the text and the end date are a database row, so
 *                         stopping or correcting it is not a deploy.
 *
 * The read is also fail-soft: it runs inside the authenticated shell on every
 * app open, so a failure must render nothing, never break the app.
 */
import { readFileSync } from "fs";
import path from "path";
import type { AppContext } from "../context";

/** Source reads are CRLF-normalised — the repo checks out with Windows endings. */
const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8").split("\r\n").join("\n");

const POPUP = read("../../../app/src/components/AnnouncementPopup.tsx");
const APP = read("../../../app/App.tsx");
const RESOLVER = read("../modules/notifications/resolvers/announcement.ts");

const mockFindOne = jest.fn();
jest.mock("../modules/notifications/models/GuardianAnnouncement", () => {
  const actual = jest.requireActual("../modules/notifications/models/GuardianAnnouncement");
  return {
    ...actual,
    GuardianAnnouncement: {
      findOne: (q: unknown) => ({ sort: () => ({ lean: async () => mockFindOne(q) }) }),
    },
  };
});

import { validateAnnouncement } from "../modules/notifications/models/GuardianAnnouncement";
import { myAnnouncement } from "../modules/notifications/services/AnnouncementService";
import { dhakaDayKey } from "../lib/dhakaDay";

function ctxFor(role: "GUARDIAN" | "TEACHER" | "PRINCIPAL" | null) {
  return {
    req: {} as AppContext["req"],
    res: {} as AppContext["res"],
    auth: role
      ? {
          userId: "u1",
          role,
          additionalTemplates: [],
          grantedPermissions: [],
          revokedPermissions: [],
        }
      : null,
  } as AppContext;
}

const ROW = {
  _id: { toString: () => "a1" },
  titleBn: "সিলেবাস প্রকাশিত হয়েছে",
  bodyBn: "বার্ষিক পরীক্ষার সিলেবাস ও মানবন্টন প্রকাশ করা হয়েছে।",
  ctaBn: "সিলেবাস দেখুন",
  deepLinkTab: "GuardianSyllabusTab",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockReturnValue(null);
});

describe("who is asked, and who is answered", () => {
  test("a guardian with a live announcement gets it", async () => {
    mockFindOne.mockReturnValue(ROW);
    const a = await myAnnouncement(ctxFor("GUARDIAN"));
    expect(a).not.toBeNull();
    expect(a!.titleBn).toBe(ROW.titleBn);
    expect(a!.deepLinkTab).toBe("GuardianSyllabusTab");
  });

  test("staff get null WITHOUT touching the database", async () => {
    // Staff have the board itself; interrupting them is noise. And the query runs
    // on every app open, so the cheapest answer for most callers matters.
    mockFindOne.mockReturnValue(ROW);
    expect(await myAnnouncement(ctxFor("TEACHER"))).toBeNull();
    expect(await myAnnouncement(ctxFor("PRINCIPAL"))).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test("an unauthenticated caller gets null, not a throw", async () => {
    expect(await myAnnouncement(ctxFor(null))).toBeNull();
  });

  test("nothing live is null, not an error", async () => {
    mockFindOne.mockReturnValue(null);
    expect(await myAnnouncement(ctxFor("GUARDIAN"))).toBeNull();
  });

  test("a read failure renders nothing rather than breaking the shell", async () => {
    // The popup mounts inside the authenticated tree. An exception here would take
    // the app down for a parent who came in to check homework (the 791e5fe rule).
    mockFindOne.mockImplementation(() => {
      throw new Error("atlas is having a day");
    });
    await expect(myAnnouncement(ctxFor("GUARDIAN"))).resolves.toBeNull();
  });
});

describe("the window", () => {
  test("the query is inclusive on both ends, against today", async () => {
    mockFindOne.mockReturnValue(ROW);
    await myAnnouncement(ctxFor("GUARDIAN"));
    const q = mockFindOne.mock.calls[0][0];
    const today = dhakaDayKey(new Date());
    // A single-day window must show on its day, so $lte / $gte, not $lt / $gt.
    expect(q).toEqual({
      audience: "GUARDIAN",
      active: true,
      startsOn: { $lte: today },
      endsOn: { $gte: today },
    });
  });

  test("todayKey is the SERVER'S Dhaka day, handed to the client", async () => {
    mockFindOne.mockReturnValue(ROW);
    const a = await myAnnouncement(ctxFor("GUARDIAN"));
    expect(a!.todayKey).toBe(dhakaDayKey(new Date()));
    expect(a!.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("validateAnnouncement", () => {
  const ok = { titleBn: "শিরোনাম", bodyBn: "বক্তব্য", startsOn: "2026-09-30", endsOn: "2026-10-06" };

  test("a well-formed announcement passes", () => {
    expect(validateAnnouncement(ok)).toBeNull();
  });

  test("a single-day window is legal", () => {
    expect(validateAnnouncement({ ...ok, endsOn: ok.startsOn })).toBeNull();
  });

  test("an unpadded date is refused", () => {
    // "2026-9-30" would never string-match a zero-padded key, so the popup would
    // simply never appear and nothing anywhere would say why.
    expect(validateAnnouncement({ ...ok, startsOn: "2026-9-30" })).not.toBeNull();
  });

  test("an end before the start is refused", () => {
    expect(validateAnnouncement({ ...ok, endsOn: "2026-09-29" })).not.toBeNull();
  });

  test("empty text is refused — a blank popup is worse than none", () => {
    expect(validateAnnouncement({ ...ok, titleBn: "  " })).not.toBeNull();
    expect(validateAnnouncement({ ...ok, bodyBn: "" })).not.toBeNull();
  });
});

describe("once a day, per announcement", () => {
  test("the seen-key is keyed on the announcement id", () => {
    // A single shared key would let an OLD announcement's "seen today" suppress a
    // NEW one on the day it launches — the one day it most needs to be seen.
    expect(POPUP).toMatch(/const seenKey = \(id: string\)[^\n]*announcement_seen_\$\{id\}/);
  });

  test("the stored key is compared against the SERVER'S day, not a local date", () => {
    expect(POPUP).toMatch(/lastShown !== announcement\.todayKey/);
    // No second implementation of "what day is it" in the client.
    expect(POPUP).not.toMatch(/toLocaleDateString|new Date\(\)\.toISOString/);
  });

  test("the key is written on DISMISS, not on show", () => {
    // Killed mid-render, the parent has read nothing and should see it again.
    const dismiss = POPUP.slice(POPUP.indexOf("const dismiss ="));
    expect(dismiss).toMatch(/setItem\(seenKey\(announcement\.id\), announcement\.todayKey\)/);
    const effect = POPUP.slice(POPUP.indexOf("useEffect("), POPUP.indexOf("const dismiss ="));
    expect(effect).not.toMatch(/setItem\(/);
  });

  test("unreadable storage shows the popup rather than hiding it", () => {
    // Private windows and blocked site data throw. Seen twice beats never seen.
    const effect = POPUP.slice(POPUP.indexOf("useEffect("), POPUP.indexOf("const dismiss ="));
    expect(effect).toMatch(/catch \{[\s\S]{0,400}?lastShown = null;/);
  });
});

describe("where it mounts and what it costs", () => {
  test("it sits beside the navigator, not inside a screen", () => {
    // A popup owned by one screen misses every other entry point: a push tap, a
    // deep link, a reload on a sub-screen.
    expect(APP).toMatch(/<ThemedNavigation \/>[\s\S]{0,700}?<AnnouncementPopup \/>/);
  });

  test("staff never even issue the query", () => {
    expect(POPUP).toMatch(/pause: !isGuardian/);
  });

  test("the query is authenticated, not permissioned", () => {
    // A permission would log a refusal on every staff render for a question that
    // has a perfectly good answer: nothing for you.
    expect(RESOLVER).toMatch(/authScopes: \{ authenticated: true \}/);
    expect(RESOLVER).toMatch(/nullable: true/);
  });

  test("an unknown deep-link tab closes the popup instead of crashing", () => {
    // Announcement rows outlive route renames; a stale tab name must not take the
    // shell down.
    const dismiss = POPUP.slice(POPUP.indexOf("const dismiss ="));
    expect(dismiss).toMatch(/navigationRef\.isReady\(\)/);
    expect(dismiss).toMatch(/try \{[\s\S]{0,400}?navigate\([\s\S]{0,200}?\} catch/);
  });
});
