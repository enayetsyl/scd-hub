/**
 * D-#1679 — the assignment-week reminder: pure body / grouping / missing-subject logic and the
 * dedupe key (recipient + day in the key, so two recipients never swallow each other). DB-free.
 */
import {
  groupDraftWeeks,
  missingSubjectsForSection,
  weekReminderBodyBn,
} from "../modules/trackers/services/AssignmentWeekReminderService";
import { schedulerDedupeKeys } from "../modules/notifications/services/SchedulerService";
import type { ExpectedWeek } from "../modules/trackers/services/AssignmentScheduleService";

const cell = (sectionId: string, subject: string, delivered: boolean, nilDeclared: boolean) =>
  ({ sectionId, subject, delivered, nilDeclared }) as unknown as ExpectedWeek["items"][number];

describe("weekReminderBodyBn", () => {
  it("names the draft and the missing subjects", () => {
    const b = weekReminderBodyBn({ nameBn: "তৃতীয় শ্রেণি · বালক", deliveredOn: new Date(2026, 10, 19), draftSubjects: ["MATH"], missingSubjects: ["ENGLISH"], totalMinutes: 85 });
    expect(b).toContain("তৃতীয় শ্রেণি · বালক");
    expect(b).toContain("১৯ নভেম্বর");
    expect(b).not.toMatch(/[0-9]/); // Bangla digits only
    expect(b).not.toContain("،"); // Bangla comma, never the Arabic one
    expect(b).toContain("বাকি:");
    expect(b).toContain("সপ্তাহ নিশ্চিত করুন");
  });
  it("with nothing missing and under the cap, no 'বাকি' line and confirm is offered", () => {
    const b = weekReminderBodyBn({ nameBn: "তৃতীয় শ্রেণি · বালক", deliveredOn: new Date(2026, 10, 19), draftSubjects: ["MATH"], missingSubjects: [], totalMinutes: 40 });
    expect(b).not.toContain("বাকি:");
    expect(b).toContain("চাপলে দেওয়াগুলো ছাত্রদের কাছে যাবে");
  });
  it("over the 360-min cap, says to trim first even when a subject is missing (confirm would be refused)", () => {
    const b = weekReminderBodyBn({ nameBn: "তৃতীয় শ্রেণি · বালক", deliveredOn: new Date(2026, 10, 19), draftSubjects: ["MATH"], missingSubjects: ["ENGLISH"], totalMinutes: 400 });
    expect(b).toContain("বাকি:");
    expect(b).toContain("৪০০ মিনিট");
    expect(b).toContain("সময় কমিয়ে");
    expect(b).not.toContain("চাপলে দেওয়াগুলো ছাত্রদের কাছে যাবে");
  });
});

describe("missingSubjectsForSection", () => {
  it("lists only this section's cells neither delivered nor nil-declared", () => {
    const week = {
      items: [
        cell("a", "MATH", true, false),
        cell("a", "ENGLISH", false, false),
        cell("a", "SCIENCE", false, true),
        cell("b", "BANGLA", false, false),
      ],
    } as unknown as ExpectedWeek;
    expect(missingSubjectsForSection(week, "a")).toEqual(["ENGLISH"]);
  });
});

describe("groupDraftWeeks", () => {
  it("groups by (year, section, week) and de-dupes subjects", () => {
    const g = groupDraftWeeks([
      { academicYearId: "y", sectionId: "a", weekNumber: 1, subject: "MATH", deliveryDate: new Date(2026, 10, 19) },
      { academicYearId: "y", sectionId: "a", weekNumber: 1, subject: "MATH", deliveryDate: new Date(2026, 10, 19) },
      { academicYearId: "y", sectionId: "a", weekNumber: 1, subject: "ENGLISH", deliveryDate: new Date(2026, 10, 19) },
      { academicYearId: "y", sectionId: "b", weekNumber: 1, subject: "MATH", deliveryDate: new Date(2026, 10, 19) },
    ] as never);
    expect(g).toHaveLength(2);
    expect(g[0].draftSubjects).toEqual(["MATH", "ENGLISH"]);
    expect(g[0].deliveredOn.getDate()).toBe(19);
  });
});

describe("asWeekPendingReminder dedupe key", () => {
  it("differs per recipient, per day and per week", () => {
    const k = schedulerDedupeKeys.asWeekPendingReminder;
    expect(k("2026-11-22", "s", 7, "u1")).not.toBe(k("2026-11-22", "s", 7, "u2"));
    expect(k("2026-11-22", "s", 7, "u1")).not.toBe(k("2026-11-23", "s", 7, "u1"));
    expect(k("2026-11-22", "s", 7, "u1")).not.toBe(k("2026-11-22", "s", 8, "u1"));
  });
});
