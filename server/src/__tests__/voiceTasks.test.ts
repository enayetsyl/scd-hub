/**
 * Voice tasks (VT-1/VT-4, D-#960–#966) — DB-free.
 *   • the name guard (Bangla normalisation, Latin skeleton, shared name parts identify nobody)
 *   • buildDraft: switch / warn on a misheard assignee, the date rule, defaults, recurrence
 *   • parseVoiceTasks: the work_board:voice gate, self-only narrowing, input limits, no key
 *   • the 08:00 / 17:00 "tasks you gave" lines and their text
 */
import { Types } from "mongoose";

const mockUserFind = jest.fn();
const mockProfiles = jest.fn();
const mockAllStaff = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => ({ select: () => ({ lean: () => mockUserFind(q) }) }) },
}));
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: { find: () => ({ select: () => ({ lean: () => mockProfiles() }) }) },
}));
jest.mock("../modules/workboard/services/WorkBoardService", () => ({
  allStaffUsers: () => mockAllStaff(),
}));
import {
  buildDraft,
  buildVoicePrompt,
  heardPeople,
  latinSkeleton,
  normaliseForMatch,
  type RawVoiceTask,
  type VoiceStaff,
} from "../modules/workboard/voice/voiceTaskDraft";
import { parseVoiceTasks, type VoiceModel } from "../modules/workboard/voice/VoiceTaskService";
import { givenSummaryLines } from "../modules/workboard/services/TaskSweepService";
import { givenSummaryBody } from "../modules/workboard/services/workBoardNotifications";
import type { AuthPayload } from "../context";

const id = () => new Types.ObjectId().toString();
const A = id(); // Akmol Hossain
const K = id(); // Kawsar Hossain — shares "Hossain" with Akmol
const M = id(); // Mahzabin Yasmin
const T = id(); // Mahmudur Rahman Tazkir
const STAFF: VoiceStaff[] = [
  { userId: A, name: "Akmol Hossain", nameBn: "আকমল হোসেন", designation: "Assistant Teacher" },
  { userId: K, name: "Kawsar Hossain", nameBn: "কাওসার হোসেন", designation: "Office Assistant" },
  { userId: M, name: "Mahzabin Yasmin", nameBn: "মাহজাবিন ইয়াসমিন", designation: "Coordinator" },
  { userId: T, name: "Mahmudur Rahman Tazkir", nameBn: null, designation: "Vice Principal" },
];
const TODAY = "2026-11-04";
const opts = { staff: STAFF, selfId: T, selfOnly: false, todayKey: TODAY };
const task = (t: RawVoiceTask): RawVoiceTask => ({ titleBn: "খাতা দেখা", recurrence: "ONCE", ...t });

describe("name guard (D-#962)", () => {
  test("Bangla normalisation drops hasanta, ZWNJ, spaces and punctuation", () => {
    expect(normaliseForMatch("আক্‌মল, ")).toBe(normaliseForMatch("আকমল"));
  });

  test("Latin skeleton makes common spellings agree", () => {
    expect(latinSkeleton("Akmol")).toBe(latinSkeleton("Akmal"));
    expect(latinSkeleton("Tazkir")).toBe(latinSkeleton("Taskir"));
    expect(latinSkeleton("Akhtar")).toBe(latinSkeleton("Aktar"));
  });

  test("a heard Bangla name with a case ending identifies its one owner", () => {
    expect([...heardPeople(STAFF, "আকমলকে খাতা দেখতে বলো", "")]).toEqual([A]);
  });

  test("a name part two people share identifies nobody", () => {
    expect(heardPeople(STAFF, "হোসেন স্যারকে বলো", "Hossain sir-ke bolo").size).toBe(0);
  });

  test("the romanised transcript catches a person with no Bangla name on file", () => {
    expect([...heardPeople(STAFF, "", "Taskir sir ke bolo")]).toEqual([T]);
  });
});

describe("buildDraft", () => {
  test("a pick whose name was not heard switches to the one person who was, with a warning", () => {
    const d = buildDraft({ transcript: "আকমলকে খাতা দেখতে বলো", tasks: [task({ assigneeUserId: K, assigneeSaid: "আকমলকে" })] }, opts);
    expect(d.tasks[0].assigneeUserId).toBe(A);
    expect(d.tasks[0].warnings.join(" ")).toMatch(/বদলে দেওয়া হলো/);
  });

  test("a confirmed pick carries no name warning; an unsaid date asks; defaults are listed", () => {
    const d = buildDraft({ transcript: "আকমলকে খাতা দেখতে বলো", tasks: [task({ assigneeUserId: A, assigneeSaid: "আকমলকে" })] }, opts);
    const c = d.tasks[0];
    expect(c.assigneeUserId).toBe(A);
    expect(c.dueKey).toBeNull();
    expect(c.warnings).toEqual(["তারিখ বলা হয়নি — বেছে নিন"]);
    expect(c.defaulted.sort()).toEqual(["effortMin", "priority", "slot"]);
    expect([c.slot, c.priority, c.effortMin]).toEqual(["ANY", "NORMAL", 30]);
  });

  test("a pick nobody's name confirms is kept but warned", () => {
    const d = buildDraft({ transcript: "স্যারকে খাতা দেখতে বলো", tasks: [task({ assigneeUserId: M, dueKey: "2026-11-05" })] }, opts);
    expect(d.tasks[0].assigneeUserId).toBe(M);
    expect(d.tasks[0].warnings.join(" ")).toMatch(/মিলিয়ে দেখুন/);
  });

  test("no pick + exactly one heard name fills it (warned); none heard leaves it empty", () => {
    const one = buildDraft({ transcript: "মাহজাবিন আপাকে বলো", tasks: [task({ dueKey: "2026-11-05" })] }, opts);
    expect(one.tasks[0].assigneeUserId).toBe(M);
    const none = buildDraft({ transcript: "কাউকে বলো", tasks: [task({ dueKey: "2026-11-05" })] }, opts);
    expect(none.tasks[0].assigneeUserId).toBeNull();
    expect(none.tasks[0].warnings).toContain("কাকে দেবেন বোঝা যায়নি — বাছুন");
  });

  test("words the model claims to have heard are ignored when they are not in the transcript", () => {
    const d = buildDraft({ transcript: "আকমলকে বলো", tasks: [task({ assigneeUserId: K, assigneeSaid: "কাওসারকে", dueKey: "2026-11-05" })] }, opts);
    expect(d.tasks[0].assigneeUserId).toBe(A);
  });

  test("a past date is cleared and warned; a future date and said fields are kept", () => {
    const past = buildDraft({ transcript: "আকমল", tasks: [task({ assigneeUserId: A, dueKey: "2026-11-01" })] }, opts);
    expect(past.tasks[0].dueKey).toBeNull();
    expect(past.tasks[0].warnings).toContain("বলা তারিখটি পেরিয়ে গেছে — তারিখ বাছুন");
    const ok = buildDraft({ transcript: "আকমল", tasks: [task({ assigneeUserId: A, dueKey: "2026-11-06", slot: "MORNING", priority: "URGENT", effortMin: 600 })] }, opts);
    expect(ok.tasks[0]).toMatchObject({ dueKey: "2026-11-06", slot: "MORNING", priority: "URGENT", effortMin: 480, defaulted: [] });
  });

  test("without work_board:assign every card is the caller's own (D-#961)", () => {
    const self: VoiceStaff[] = [STAFF[3]];
    const d = buildDraft({ transcript: "আকমলকে বলো", tasks: [task({ assigneeUserId: A, dueKey: "2026-11-05" })] }, { staff: self, selfId: T, selfOnly: true, todayKey: TODAY });
    expect(d.tasks[0].assigneeUserId).toBe(T);
    expect(d.tasks[0].defaulted).toContain("assignee");
    expect(d.tasks[0].warnings[0]).toMatch(/অনুমতি নেই/);
  });

  test("a complete recurrence is kept without a due date; an incomplete one falls back to ONCE (D-#964)", () => {
    const d = buildDraft(
      {
        transcript: "আকমল মাহজাবিন",
        tasks: [
          task({ assigneeUserId: A, recurrence: "MONTHLY_WEEKDAY", weekdays: [6], weekOfMonth: 1, dueKey: "2026-11-07", endKey: "2026-12-31" }),
          task({ assigneeUserId: M, recurrence: "WEEKLY", weekdays: [] }),
        ],
      },
      opts,
    );
    expect(d.tasks[0]).toMatchObject({ recurrence: "MONTHLY_WEEKDAY", weekdays: [6], weekOfMonth: 1, dueKey: null, endKey: "2026-12-31" });
    expect(d.tasks[1].recurrence).toBe("ONCE");
    expect(d.tasks[1].warnings[0]).toMatch(/একবারের কাজ/);
  });

  test("a card with no title is dropped and counted; nothing understood says so", () => {
    const d = buildDraft({ transcript: "...", tasks: [{ titleBn: "  ", recurrence: "ONCE" }] }, opts);
    expect(d.tasks).toHaveLength(0);
    expect(d.warnings).toEqual(["1টি কাজের শিরোনাম বোঝা যায়নি — বাদ দেওয়া হলো", "কোনো কাজ বোঝা যায়নি — আবার বলুন"]);
  });

  test("the prompt carries today, the weekday, every allowed id and the speaker mark", () => {
    const p = buildVoicePrompt({ todayKey: TODAY, staff: STAFF, selfId: T, priorDraftJson: '{"tasks":[]}' });
    expect(p).toContain("Today is 2026-11-04 (Wednesday)");
    for (const s of STAFF) expect(p).toContain(s.userId);
    expect(p).toContain(`${T} | Mahmudur Rahman Tazkir | - | Vice Principal | (the speaker)`);
    expect(p).toContain("PENDING DRAFT");
  });
});

describe("parseVoiceTasks", () => {
  const principal: AuthPayload = { userId: T, role: "PRINCIPAL" };
  const teacherVoice: AuthPayload = { userId: A, role: "TEACHER", grantedPermissions: ["work_board:voice"] };
  const teacher: AuthPayload = { userId: A, role: "TEACHER" };
  const NOW = new Date(2026, 10, 4, 10, 0);

  const fake = (reply: object): VoiceModel & { prompts: string[]; audio: unknown[] } => {
    const m = {
      prompts: [] as string[],
      audio: [] as unknown[],
      run: async (prompt: string, audio: unknown) => {
        m.prompts.push(prompt);
        m.audio.push(audio);
        return reply;
      },
    };
    return m;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockProfiles.mockResolvedValue([]);
    mockAllStaff.mockResolvedValue(STAFF.map((s) => ({ _id: new Types.ObjectId(s.userId), name: s.name, role: "TEACHER" })));
    mockUserFind.mockImplementation(async (q: { _id: string }) => {
      const s = STAFF.find((x) => x.userId === q._id)!;
      return [{ _id: new Types.ObjectId(s.userId), name: s.name, role: "TEACHER" }];
    });
  });

  test("refused without work_board:voice, before the model is called (AC-1)", async () => {
    const m = fake({ transcript: "", tasks: [] });
    await expect(parseVoiceTasks(teacher, { text: "আকমলকে বলো" }, m, NOW)).rejects.toThrow("কণ্ঠে কাজ দেওয়ার অনুমতি নেই");
    await expect(parseVoiceTasks(null, { text: "x" }, m, NOW)).rejects.toThrow("Unauthenticated");
    expect(m.prompts).toHaveLength(0);
  });

  test("no key configured is a clear refusal (AC-10)", async () => {
    await expect(parseVoiceTasks(principal, { text: "আকমলকে বলো" }, null, NOW)).rejects.toThrow(/GEMINI_API_KEY/);
  });

  test("input limits: nothing said, bad mime, oversize audio, broken prior draft", async () => {
    const m = fake({ transcript: "", tasks: [] });
    await expect(parseVoiceTasks(principal, {}, m, NOW)).rejects.toThrow("কিছু বলা বা লেখা হয়নি");
    await expect(parseVoiceTasks(principal, { audioBase64: "AAAA", mimeType: "video/mp4" }, m, NOW)).rejects.toThrow("এই ধরনের রেকর্ডিং পড়া যায় না");
    await expect(parseVoiceTasks(principal, { audioBase64: "A".repeat(6_000_001), mimeType: "audio/wav" }, m, NOW)).rejects.toThrow(/৯০ সেকেন্ডের/);
    await expect(parseVoiceTasks(principal, { text: "x", priorDraftJson: "{nope" }, m, NOW)).rejects.toThrow("আগের খসড়াটি পড়া যায়নি");
  });

  test("an assigner gets the whole staff list; audio goes up as inline data with its bare mime type", async () => {
    const m = fake({ transcript: "আকমলকে কাল খাতা দেখতে বলো", tasks: [task({ assigneeUserId: A, assigneeSaid: "আকমলকে", dueKey: "2026-11-05" })] });
    const d = await parseVoiceTasks(principal, { audioBase64: "UklGRg==", mimeType: "audio/wav;codecs=1" }, m, NOW);
    expect(d.tasks[0]).toMatchObject({ assigneeUserId: A, dueKey: "2026-11-05" });
    expect(m.audio[0]).toEqual({ mimeType: "audio/wav", data: "UklGRg==" });
    for (const s of STAFF) expect(m.prompts[0]).toContain(s.userId);
  });

  test("a voice-only teacher is offered only themselves (AC-2)", async () => {
    const m = fake({ transcript: "কাওসারকে বলো", tasks: [task({ assigneeUserId: K, dueKey: "2026-11-05" })] });
    const d = await parseVoiceTasks(teacherVoice, { text: "কাওসারকে বলো" }, m, NOW);
    expect(m.prompts[0]).toContain(A);
    expect(m.prompts[0]).not.toContain(K);
    expect(d.tasks[0].assigneeUserId).toBe(A);
    expect(mockAllStaff).not.toHaveBeenCalled();
  });
});

describe("tasks-you-gave summaries (D-#966)", () => {
  const giver = new Types.ObjectId();
  const other = new Types.ObjectId();
  const t = (o: Partial<{ dueKey: string; status: string; blockedReason: string; doneAt: Date; self: boolean }>) => ({
    assignedBy: giver,
    assigneeUserId: o.self ? giver : other,
    dueKey: o.dueKey ?? TODAY,
    status: (o.status ?? "TODO") as "TODO",
    blockedReason: o.blockedReason,
    doneAt: o.doneAt,
  });

  test("AM counts open work given to others; self-tasks and future work never count", () => {
    const lines = givenSummaryLines([t({}), t({ dueKey: "2026-11-02" }), t({ self: true }), t({ dueKey: "2026-11-09" })], TODAY, "AM");
    expect(lines).toEqual([{ recipientId: giver.toString(), dueToday: 1, overdue: 1, doneToday: 0, open: 2, blocked: 0 }]);
    expect(givenSummaryBody(lines[0], "AM")).toBe("আপনার দেওয়া কাজ: আজকের 1টি বাকি, 1টি বকেয়া।");
  });

  test("PM adds done-today and blocked; a giver with nothing open and nothing done gets no row", () => {
    const lines = givenSummaryLines(
      [t({ status: "DONE", doneAt: new Date(2026, 10, 4, 12) }), t({ status: "DONE", doneAt: new Date(2026, 10, 3, 12) }), t({ blockedReason: "কাগজ নেই" })],
      TODAY,
      "PM",
    );
    expect(lines[0]).toMatchObject({ doneToday: 1, open: 1, blocked: 1 });
    expect(givenSummaryBody(lines[0], "PM")).toBe("আজ আপনার দেওয়া কাজ: 1টি শেষ, 1টি বাকি, 1টি আটকে।");
    expect(givenSummaryLines([t({ status: "DONE", doneAt: new Date(2026, 10, 1) })], TODAY, "PM")).toEqual([]);
    expect(givenSummaryLines([t({ status: "DONE", doneAt: new Date(2026, 10, 4, 9) })], TODAY, "AM")).toEqual([]);
  });
});
