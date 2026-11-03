/**
 * D-#913 — when is a task-tied pop-up's task finished? MEETING_SUMMARIES reads the class
 * teacher's own summary work list (the Today card's read): done only when no child is
 * READY or WAITING in any open meeting; no class-teacher sections at all = done.
 */
import { isTaskDone } from "../modules/popup-notices/services/popupDoneWhen";
import { mySummaryWork } from "../modules/comments/services/MeetingChainService";

jest.mock("../modules/comments/services/MeetingChainService", () => ({ mySummaryWork: jest.fn() }));
const work = mySummaryWork as jest.MockedFunction<typeof mySummaryWork>;

const NOW = new Date("2026-11-03T04:00:00.000Z");
const meeting = (sections: Array<{ ready: number; waiting: number; done: number }>) =>
  ({ meetingId: "m", instanceLabel: "নভেম্বর", meetingDateKey: "2026-11-08", summaryDueKey: "2026-11-04", sections: sections.map((s) => ({ sectionId: "s", classLevel: 4, classNameBn: "", sectionNameBn: "", students: [], ...s })) });

test("MEETING_SUMMARIES: done only when nothing is ready or waiting", async () => {
  work.mockResolvedValueOnce([meeting([{ ready: 2, waiting: 0, done: 5 }])]);
  expect(await isTaskDone("MEETING_SUMMARIES", "u1", NOW)).toBe(false);
  work.mockResolvedValueOnce([meeting([{ ready: 0, waiting: 1, done: 6 }])]);
  expect(await isTaskDone("MEETING_SUMMARIES", "u1", NOW)).toBe(false);
  work.mockResolvedValueOnce([meeting([{ ready: 0, waiting: 0, done: 7 }]), meeting([{ ready: 0, waiting: 0, done: 3 }])]);
  expect(await isTaskDone("MEETING_SUMMARIES", "u1", NOW)).toBe(true);
  expect(work).toHaveBeenLastCalledWith("u1", NOW);
});

test("MEETING_SUMMARIES: no longer anyone's class teacher (or no open meeting) = done", async () => {
  work.mockResolvedValueOnce([]);
  expect(await isTaskDone("MEETING_SUMMARIES", "u2", NOW)).toBe(true);
});
