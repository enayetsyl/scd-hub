/**
 * AL-8 — the suggestion screens' pure parts and wiring (the app workspace has no test runner, so this static / pure read
 * lives here, like notificationNavCoverage). docs/prd-academic-loop-2027.md §4.5, §4.6.
 */
import { readFileSync } from "fs";
import path from "path";

const APP = path.resolve(__dirname, "../../../app/src");
const read = (p: string) => readFileSync(path.join(APP, p), "utf8");
const { reviewWeekThursday } = require("../../../app/src/lib/asWeek") as { reviewWeekThursday: (d?: Date) => string };
const { notificationTarget } = require("../../../app/src/lib/notificationNav") as {
  notificationTarget: (kind: string, refs: Record<string, string | null>, role: string | null) => { tab: string; screen: string; params?: Record<string, unknown> } | null;
};

describe("the week the screen opens on", () => {
  it("Monday to Thursday → this week's Thursday; Friday to Sunday → the coming one", () => {
    expect(reviewWeekThursday(new Date(2027, 0, 11))).toBe("2027-01-14"); // Mon
    expect(reviewWeekThursday(new Date(2027, 0, 13))).toBe("2027-01-14"); // Wed (the draft day)
    expect(reviewWeekThursday(new Date(2027, 0, 14))).toBe("2027-01-14"); // Thu
    expect(reviewWeekThursday(new Date(2027, 0, 15))).toBe("2027-01-21"); // Fri
    expect(reviewWeekThursday(new Date(2027, 0, 17))).toBe("2027-01-21"); // Sun
  });
});

describe("the three notices open the right screen", () => {
  const refs = { sectionId: "S1", subject: "MATH", masteryAssignmentId: "A1" };
  it("a draft-ready notice and a comment open the draft by id", () => {
    for (const kind of ["AS_DRAFT_READY", "AS_COMMENT"]) {
      expect(notificationTarget(kind, refs, "TEACHER")).toEqual({ tab: "MasteryTab", screen: "AssignmentDraftReview", params: { assignmentId: "A1" } });
    }
  });
  it("the swap card opens the শাখা's week (a drop-subject teacher's id is another subject's draft)", () => {
    expect(notificationTarget("AS_SWAP_SUGGESTED", refs, "TEACHER")).toEqual({ tab: "MasteryTab", screen: "AssignmentWeekReview", params: { sectionId: "S1" } });
  });
  it("the swap card carries the week's date so the right week opens", () => {
    expect(notificationTarget("AS_SWAP_SUGGESTED", { ...refs, date: "2027-01-14" }, "TEACHER")?.params).toEqual({ sectionId: "S1", dueDate: "2027-01-14" });
  });
  it("a notice with no refs still lands on a screen", () => {
    expect(notificationTarget("AS_DRAFT_READY", {}, "TEACHER")?.screen).toBe("MasteryWork");
  });
});

describe("the screens are wired and gated", () => {
  it("the three routes are registered and typed", () => {
    const tabs = read("navigation/AppTabs.tsx");
    const types = read("navigation/types.ts");
    for (const r of ["AssignmentWeekReview", "AssignmentDraftReview", "AssignmentOfficeWeeks"]) {
      expect(tabs).toContain(`name="${r}"`);
      expect(types).toContain(`${r}:`);
    }
  });
  it("the entry buttons show only with the release switch on (§3.6)", () => {
    const home = read("screens/mastery/MasteryWorkHomeScreen.tsx");
    expect(home).toMatch(/loopOn && active && \(can\("assignment:suggest"\) \|\| can\("assignment:view_all"\)\)/);
  });
  it("the comment box needs assignment:comment; the rebuild asks first", () => {
    expect(read("screens/mastery/AssignmentDraftReviewScreen.tsx")).toContain('can("assignment:comment")');
    expect(read("screens/mastery/AssignmentWeekReviewScreen.tsx")).toContain("STR.al8RebuildTitle");
  });
  it("a swap whose dropped draft was edited is confirmed with the loss spelled out", () => {
    const week = read("screens/mastery/AssignmentWeekReviewScreen.tsx");
    expect(week).toContain("al8SwapEditedMsg");
    expect(week).toContain("confirmEdited");
  });
  it("AC-R1: with the switch OFF the sheet's bank picker is not drawn and the Today card runs no query", () => {
    const sheet = read("screens/mastery/MasteryAssignmentSheetScreen.tsx");
    expect(sheet).toContain("editable && loopOn ? <AssignmentBankPicker");
    expect(sheet).toContain("academicLoop2027On === true");
    const card = read("components/AssignmentNewsTodayCard.tsx");
    expect(card).toContain("pause: !loopOn");
    expect(card).toContain("kinds: KINDS"); // the kind filter runs on the server, not on the newest 50
  });
  it("the controls follow the server's mayEdit / mayFinalise, not a client permission guess", () => {
    const draft = read("screens/mastery/AssignmentDraftReviewScreen.tsx");
    expect(draft).toContain("loaded?.mayEdit === true");
    expect(draft).toContain("loaded?.mayFinalise === true");
    expect(read("screens/mastery/MasteryAssignmentSheetScreen.tsx")).toContain("?.mayEdit === true");
  });
  it("a comment's date is shown in Dhaka time", () => {
    expect(read("screens/mastery/AssignmentDraftReviewScreen.tsx")).toContain("isoDateTimeLabel(c.createdAt)");
  });
  it("Bangla wording: বদলি শিক্ষক / শ্রেণি শিক্ষক / প্রধান শিক্ষক / শিক্ষার্থী in the al8 strings", () => {
    const labels = read("lib/labels.ts");
    const al8 = labels.split(/\r?\n/).filter((l) => l.startsWith("  al8") && !l.startsWith("  al8LoadTitle"));
    const bad = al8.filter((l) => /সহকারী শিক্ষক|ক্লাস শিক্ষক|অধ্যক্ষ|শিশু/.test(l));
    expect(bad).toEqual([]);
  });
});
