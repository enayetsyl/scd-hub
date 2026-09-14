/**
 * Subject-group anchor invariants for the observation UPLOAD form (owner report,
 * 2026-09-14: "the arabic is not related to any class … need to give dropdown option
 * … instead of id populated name dropdown").
 *
 * Two halves, both about a gap the SERVER cannot close. `assertAnchor` in
 * `ClassroomObservationService` requires exactly one of sectionId/subjectGroupId and
 * that form ↔ subject agree (CO-5) — but it NEVER loads the group, so it will accept
 * an ARABIC observation anchored to a Quran group, or to a group id that exists
 * nowhere at all. While the field was a free-text box that was not theoretical: the
 * uploader had to type a raw ObjectId, and any 24-hex string was taken.
 *
 *   1. `groupTrackForSubject` (pure, unit-tested below) is the track filter itself.
 *   2. The SCREEN has to be wired to it — the picker must be a Select fed by
 *      SUBJECT_GROUPS_QUERY with that track, and a subject change must DROP the
 *      chosen group. Both are properties of how the screen is wired, which is
 *      exactly what a later reader can undo without any test going red.
 *
 * Static source reads for half 2, deliberately: the app workspace has no test runner
 * (see `navInitialRoute.test.ts` / `observationDraftInvariants.test.ts` for the same
 * reasoning). Half 1 is a real import, the `homeworkText` posture in
 * `guardianDayCard.test.ts`.
 */
import { readFileSync } from "fs";
import path from "path";

const SCREEN = path.resolve(
  __dirname,
  "../../../app/src/screens/observation/UploadObservationScreen.tsx",
);
const screenSrc = readFileSync(SCREEN, "utf8");

const { groupTrackForSubject, isGroupTaughtSubject } =
  require("../../../app/src/lib/observationAnchor") as {
    groupTrackForSubject: (s: string | null | undefined) => "quran" | "arabic" | null;
    isGroupTaughtSubject: (s: string | null | undefined) => boolean;
  };

describe("groupTrackForSubject", () => {
  test("Quran and Arabic each resolve to their OWN track", () => {
    // The whole point: they are two different tracks, not one "religious" bucket.
    // Collapsing them would offer Hifz groups on an Arabic observation.
    expect(groupTrackForSubject("QURAN")).toBe("quran");
    expect(groupTrackForSubject("ARABIC")).toBe("arabic");
  });

  test("a general subject has no track of its own", () => {
    // null = "do not filter", so a general subject still sees every live group
    // rather than an empty picker. It is section-anchored in practice.
    for (const s of ["BAN", "ENG", "MATH", "SCI", "BGS", "ISLAM"]) {
      expect(groupTrackForSubject(s)).toBeNull();
    }
  });

  test("ISLAM is NOT group-taught — it is a class subject", () => {
    // Easy to lump in with Quran/Arabic; it is not. Islam runs against a Section.
    expect(isGroupTaughtSubject("ISLAM")).toBe(false);
  });

  test("nothing selected yet resolves to no track, not a crash", () => {
    expect(groupTrackForSubject(null)).toBeNull();
    expect(groupTrackForSubject(undefined)).toBeNull();
    expect(isGroupTaughtSubject(null)).toBe(false);
  });

  test("Quran and Arabic are the group-taught pair", () => {
    expect(isGroupTaughtSubject("QURAN")).toBe(true);
    expect(isGroupTaughtSubject("ARABIC")).toBe(true);
  });
});

describe("upload form — subject-group anchor wiring", () => {
  test("the group anchor is a picker, NOT a free-text id box", () => {
    // The reported bug. A `Field` here means the uploader is typing a raw ObjectId
    // again, which no one knows and the server does not verify.
    const anchorBranch = screenSrc.match(
      /anchor === "SECTION" \? \([\s\S]*?\) : \(([\s\S]*?)\n {12}\)\}/,
    );
    expect(anchorBranch).not.toBeNull();
    const groupBranch = anchorBranch![1];
    expect(groupBranch).toContain("<Select");
    expect(groupBranch).not.toContain("<Field");
    expect(groupBranch).toContain("subjectGroupOptions");
  });

  test("the picker shows the group's NAME, not its id", () => {
    // `nameBn` is what the school calls the group; `code` is the readable fallback
    // for a row whose Bangla name was never filled in. The id must not be the label.
    const opts = screenSrc.match(/const subjectGroupOptions = useMemo\(([\s\S]*?)\n {2}\}, \[/);
    expect(opts).not.toBeNull();
    expect(opts![1]).toMatch(/label:\s*g\.nameBn/);
    expect(opts![1]).toMatch(/value:\s*g\.id/);
  });

  test("the group list is filtered by the subject's OWN track", () => {
    // Without the track variable the Arabic uploader is offered Hifz groups and the
    // Quran uploader is offered Book 1 — and the server would store either.
    expect(screenSrc).toMatch(/groupTrack\s*=\s*groupTrackForSubject\(subject\)/);
    const q = screenSrc.match(/query: SUBJECT_GROUPS_QUERY,([\s\S]*?)\}\);/);
    expect(q).not.toBeNull();
    expect(q![1]).toContain("track: groupTrack");
  });

  test("changing the subject DROPS the chosen group", () => {
    // The list is re-filtered by track on a subject change; keeping the old id would
    // silently carry a Quran group onto an Arabic observation. The server accepts it.
    const handler = screenSrc.match(/function handleSubjectChange\(([\s\S]*?)\n {2}\}/);
    expect(handler).not.toBeNull();
    expect(handler![1]).toContain("setSubjectGroupId(null)");
  });

  test("changing the FORM drops the chosen group too", () => {
    // A form change resets the subject, so the track changes with it.
    const handler = screenSrc.match(/function handleFormChange\(([\s\S]*?)\n {2}\}/);
    expect(handler).not.toBeNull();
    expect(handler![1]).toContain("setSubjectGroupId(null)");
  });

  test("picking a group-taught subject moves the anchor off Section", () => {
    // There is no section that sat a Quran or Arabic session, so leaving the anchor
    // on Section hands the uploader a class list that cannot be right.
    const handler = screenSrc.match(/function handleSubjectChange\(([\s\S]*?)\n {2}\}/);
    expect(handler![1]).toContain("isGroupTaughtSubject");
    expect(handler![1]).toContain('setAnchor("SUBJECT_GROUP")');
    expect(handler![1]).toContain("setSectionId(null)");
  });

  test("an empty list mid-fetch does not claim no groups exist", () => {
    // The D-#651 lesson: an empty list rendered as a definitive "none" reads as a
    // broken feature rather than as a pending load.
    expect(screenSrc).toMatch(/groupsQ\.fetching \? STR\.loading : STR\.obsNoSubjectGroups/);
  });
});
