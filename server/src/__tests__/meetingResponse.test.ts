/**
 * D-#840–#843 — a family's answer to its parents'-meeting slot, and the Principal/VP's
 * ruling on a change request (docs/prd-meeting-rsvp.md).
 *
 *   myMeetingSlots       only dispatched, not-yet-past meetings; own linked children only;
 *                        option-2 times exclude the own slot and On-Call slots
 *   respondToMeetingSlot one final answer per family (also under a race); link + meeting
 *                        guards; change needs another timed slot of the same meeting;
 *                        can't-come reason optional and capped
 *   reviewMeetingChange  decline keeps the time; approve swaps the two families; the moved
 *                        family is re-asked (CANT_COME kept); mutual requests both approve;
 *                        another pending request blocks; keyed by the wanted TIME
 *   meetingResponseSummary the derived counts
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ParentMeeting } from "../modules/comments/models/ParentMeeting";
import { ParentMeetingSlot } from "../modules/comments/models/ParentMeetingSlot";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { Student } from "../modules/foundation/models/Student";
import {
  myMeetingSlots,
  respondToMeetingSlot,
  acknowledgeMeetingChange,
  reviewMeetingChange,
  meetingResponseSummary,
  isMeetingOpenForAnswers,
} from "../modules/comments/services/MeetingResponseService";
import { ParentMeetingError } from "../modules/comments/services/ParentMeetingService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const NOW = new Date("2026-10-24T06:00:00.000Z"); // 12:00 Dhaka, Saturday 24 Oct
const PRINCIPAL = new Types.ObjectId().toString();
let seq = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    ParentMeeting.deleteMany({}),
    ParentMeetingSlot.deleteMany({}),
    Guardian.deleteMany({}),
    GuardianLink.deleteMany({}),
    Student.deleteMany({}),
  ]);
});

async function meeting(date = "2026-10-30", status = "scheduled"): Promise<Types.ObjectId> {
  const r = await ParentMeeting.collection.insertOne({
    academicYearId: new Types.ObjectId(),
    instanceLabel: "2026 — 2nd",
    meetingDate: new Date(`${date}T00:00:00.000Z`),
    slotMinutes: 10,
    dayStartMinutes: 600,
    status,
    includeScope: { classIds: [], sectionIds: [] },
  });
  return r.insertedId;
}

async function student(name: string): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({
    schoolId: `S-${seq}`,
    name,
    classId: new Types.ObjectId(),
    sectionId: new Types.ObjectId(),
    active: true,
  });
  return r.insertedId;
}

async function guardian(childIds: Types.ObjectId[], active = true): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({
    identifierKind: "phone",
    identifier: `0170000${seq}`,
    name: `G${seq}`,
    loginEnabled: true,
    active,
  });
  for (const c of childIds) {
    await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: c, relation: "father", active: true });
  }
  return r.insertedId.toString();
}

async function slot(
  meetingId: Types.ObjectId,
  order: number,
  slotTime: number | null,
  studentIds: Types.ObjectId[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await ParentMeetingSlot.collection.insertOne({
    meetingId,
    familyKey: `88017${order}${seq}`,
    studentIds,
    classLabels: studentIds.map(() => "Three"),
    order,
    slotTime,
    onCall: slotTime == null,
    dispatchedAt: NOW,
    ...extra,
  });
  return r.insertedId.toString();
}

const reload = async (id: string) => ParentMeetingSlot.findById(id).lean();

/** A scheduled meeting with four families: 10:00, 10:10, 10:20 and one On-Call. */
async function fourFamilies() {
  const m = await meeting();
  const kids = await Promise.all(["Asila", "Borna", "Chayan", "Dipu"].map(student));
  const gs = await Promise.all(kids.map((k) => guardian([k])));
  const slots = [
    await slot(m, 0, 600, [kids[0]]),
    await slot(m, 1, 610, [kids[1]]),
    await slot(m, 2, 620, [kids[2]]),
    await slot(m, 3, null, [kids[3]]),
  ];
  return { m, kids, gs, slots };
}

const answer = (slotId: string, guardianId: string, choice: string, extra: Record<string, string> = {}) =>
  respondToMeetingSlot({ slotId, guardianId, choice, now: NOW, ...extra });

// ===========================================================================

describe("isMeetingOpenForAnswers", () => {
  it("is open through the meeting's own Dhaka day", () => {
    const d = new Date("2026-10-24T00:00:00.000Z");
    expect(isMeetingOpenForAnswers(d, new Date("2026-10-24T17:59:00.000Z"))).toBe(true); // 23:59 Dhaka
    expect(isMeetingOpenForAnswers(d, new Date("2026-10-24T18:01:00.000Z"))).toBe(false); // 00:01 next day
  });
});

describe("myMeetingSlots", () => {
  it("returns the family's slot with the other TIMED slots as times only", async () => {
    const { gs, slots } = await fourFamilies();
    const [ask] = await myMeetingSlots(gs[0], NOW);
    expect(ask.slotId).toBe(slots[0]);
    expect(ask.slotTime).toBe(600);
    expect(ask.childNames).toEqual(["Asila"]);
    expect(ask.response).toBeNull();
    expect(ask.choices.map((c) => c.slotTime)).toEqual([610, 620]); // not own, not On-Call
    expect(JSON.stringify(ask.choices)).not.toMatch(/Borna|Chayan/);
  });

  it("skips draft and past meetings", async () => {
    const draft = await meeting("2026-10-30", "draft");
    const past = await meeting("2026-10-23");
    const k = await student("Esha");
    const g = await guardian([k]);
    await slot(draft, 0, 600, [k]);
    await slot(past, 0, 600, [k]);
    expect(await myMeetingSlots(g, NOW)).toEqual([]);
  });

  it("names only the guardian's own linked children in a shared slot", async () => {
    const m = await meeting();
    const mine = await student("Faria");
    const other = await student("Gazi");
    const g = await guardian([mine]);
    await slot(m, 0, 600, [mine, other]);
    const [ask] = await myMeetingSlots(g, NOW);
    expect(ask.childNames).toEqual(["Faria"]);
  });

  it("returns nothing for an inactive guardian or a staff id", async () => {
    const m = await meeting();
    const k = await student("Hira");
    const g = await guardian([k], false);
    await slot(m, 0, 600, [k]);
    expect(await myMeetingSlots(g, NOW)).toEqual([]);
    expect(await myMeetingSlots(PRINCIPAL, NOW)).toEqual([]);
  });
});

describe("respondToMeetingSlot", () => {
  it("CONFIRMED is final — a second answer, even by another guardian of the family, is refused", async () => {
    const { kids, gs, slots } = await fourFamilies();
    const ask = await answer(slots[0], gs[0], "CONFIRMED");
    expect(ask.response?.choice).toBe("CONFIRMED");
    const mother = await guardian([kids[0]]);
    await expect(answer(slots[0], mother, "CANT_COME")).rejects.toThrow("ইতিমধ্যে উত্তর দেওয়া হয়েছে");
    expect((await myMeetingSlots(mother, NOW))[0].response?.choice).toBe("CONFIRMED");
  });

  it("lets exactly one of two simultaneous answers land", async () => {
    const { kids, gs, slots } = await fourFamilies();
    const mother = await guardian([kids[0]]);
    const results = await Promise.allSettled([
      answer(slots[0], gs[0], "CONFIRMED"),
      answer(slots[0], mother, "CANT_COME"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("refuses a guardian not linked to the slot, a staff id, and a bad choice", async () => {
    const { gs, slots } = await fourFamilies();
    await expect(answer(slots[0], gs[1], "CONFIRMED")).rejects.toThrow(ParentMeetingError);
    await expect(answer(slots[0], PRINCIPAL, "CONFIRMED")).rejects.toThrow(ParentMeetingError);
    await expect(answer(slots[0], gs[0], "MAYBE")).rejects.toThrow("উত্তরটি সঠিক নয়");
  });

  it("refuses once the meeting day has passed or the meeting is not dispatched", async () => {
    const past = await meeting("2026-10-23");
    const draft = await meeting("2026-10-30", "draft");
    const k = await student("Ina");
    const g = await guardian([k]);
    const s1 = await slot(past, 0, 600, [k]);
    const s2 = await slot(draft, 0, 600, [k]);
    await expect(answer(s1, g, "CONFIRMED")).rejects.toThrow("সময় শেষ");
    await expect(answer(s2, g, "CONFIRMED")).rejects.toThrow("সময় শেষ");
  });

  it("CHANGE_REQUESTED needs another timed slot of the same meeting, and snapshots its time", async () => {
    const { gs, slots } = await fourFamilies();
    const otherMeeting = await meeting();
    const foreign = await slot(otherMeeting, 0, 640, [await student("Jui")]);
    await expect(answer(slots[0], gs[0], "CHANGE_REQUESTED")).rejects.toThrow("পছন্দের সময় বেছে নিন");
    for (const bad of [slots[0], slots[3], foreign]) {
      await expect(answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: bad })).rejects.toThrow(
        "পছন্দের সময়টি সঠিক নয়",
      );
    }
    const ask = await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    expect(ask.response).toMatchObject({ choice: "CHANGE_REQUESTED", preferredSlotTime: 620, reviewOutcome: null });
  });

  it("CANT_COME takes an optional reason, capped at 500", async () => {
    const { gs, slots } = await fourFamilies();
    await expect(answer(slots[0], gs[0], "CANT_COME", { reason: "x".repeat(501) })).rejects.toThrow("৫০০");
    expect((await answer(slots[0], gs[0], "CANT_COME", { reason: "  " })).response?.reason).toBeNull();
    expect((await answer(slots[1], gs[1], "CANT_COME", { reason: " বিদেশে আছি " })).response?.reason).toBe(
      "বিদেশে আছি",
    );
  });
});

describe("reviewMeetingChange", () => {
  it("decline keeps the time and records the ruling", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    const r = await reviewMeetingChange(slots[0], false, "দুঃখিত", PRINCIPAL, NOW);
    expect(r).toMatchObject({ outcome: "DECLINED", movedSlotId: null });
    const s = await reload(slots[0]);
    expect(s?.slotTime).toBe(600);
    expect(s?.response?.review).toMatchObject({ outcome: "DECLINED", note: "দুঃখিত" });
    await expect(reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW)).rejects.toThrow("অপেক্ষমাণ");
  });

  it("approve swaps the two families; the moved CONFIRMED family is asked again", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[2], gs[2], "CONFIRMED");
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    const r = await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    expect(r).toMatchObject({ outcome: "APPROVED", movedSlotId: slots[2], mutual: false });

    const req = await reload(slots[0]);
    const moved = await reload(slots[2]);
    expect([req?.slotTime, req?.order]).toEqual([620, 2]);
    expect([moved?.slotTime, moved?.order]).toEqual([600, 0]);
    expect(req?.response?.review).toMatchObject({ outcome: "APPROVED", fromSlotTime: 600 });
    expect(moved?.response).toBeUndefined();
    expect(moved?.rescheduledAt).toBeTruthy();
    // The untouched family did not move.
    expect((await reload(slots[1]))?.slotTime).toBe(610);
    // The moved family's pop-up is back, with its new time.
    const [ask] = await myMeetingSlots(gs[2], NOW);
    expect([ask.response, ask.slotTime, !!ask.rescheduledAt]).toEqual([null, 600, true]);
  });

  it("a moved family's CANT_COME answer is kept", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[1], gs[1], "CANT_COME");
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[1] });
    await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    expect((await reload(slots[1]))?.response?.choice).toBe("CANT_COME");
  });

  it("a mutual request is approved for both families by one swap", async () => {
    const { m, gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[1] });
    await answer(slots[1], gs[1], "CHANGE_REQUESTED", { preferredSlotId: slots[0] });
    const r = await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    expect(r.mutual).toBe(true);
    expect((await reload(slots[1]))?.response?.review?.outcome).toBe("APPROVED");
    expect((await reload(slots[1]))?.slotTime).toBe(600);
    expect((await meetingResponseSummary(m.toString())).changeApproved).toBe(2);
  });

  it("is refused while the wanted-time family has its own pending request elsewhere", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[1], gs[1], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[1] });
    await expect(reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW)).rejects.toThrow("আগে সেটি নিষ্পত্তি করুন");
    expect((await reload(slots[0]))?.slotTime).toBe(600);
  });

  it("follows the wanted TIME when another swap has already moved that slot's family", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] }); // A wants 10:20 (C)
    await answer(slots[1], gs[1], "CHANGE_REQUESTED", { preferredSlotId: slots[2] }); // B wants 10:20 (C)
    await reviewMeetingChange(slots[1], true, null, PRINCIPAL, NOW); // B ↔ C: B now 10:20, C 10:10
    // A's request is still for 10:20 — now held by B, whose request is already ruled on.
    await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    expect((await reload(slots[0]))?.slotTime).toBe(620);
    expect((await reload(slots[1]))?.slotTime).toBe(600);
    expect((await reload(slots[2]))?.slotTime).toBe(610);
    // B had an approved change; being moved again clears it so B is asked about 10:00.
    expect((await reload(slots[1]))?.response).toBeUndefined();
  });
});

describe("acknowledgeMeetingChange (D-#844)", () => {
  it("is refused before a ruling and for an unlinked guardian", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    await expect(acknowledgeMeetingChange(slots[0], gs[0], NOW)).rejects.toThrow("সিদ্ধান্ত হয়নি");
    await reviewMeetingChange(slots[0], false, null, PRINCIPAL, NOW);
    await expect(acknowledgeMeetingChange(slots[0], gs[1], NOW)).rejects.toThrow(ParentMeetingError);
  });

  it("stamps seenAt once; a second call (other parent) keeps the first stamp", async () => {
    const { kids, gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[2] });
    await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    const before = (await myMeetingSlots(gs[0], NOW))[0];
    expect([before.response?.reviewOutcome, before.response?.reviewSeenAt]).toEqual(["APPROVED", null]);
    const ask = await acknowledgeMeetingChange(slots[0], gs[0], NOW);
    expect(ask.response?.reviewSeenAt).toBe(NOW.toISOString());
    const mother = await guardian([kids[0]]);
    const later = new Date(NOW.getTime() + 60_000);
    expect((await acknowledgeMeetingChange(slots[0], mother, later)).response?.reviewSeenAt).toBe(NOW.toISOString());
  });

  it("a mutual request's other family also has an outcome to see", async () => {
    const { gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CHANGE_REQUESTED", { preferredSlotId: slots[1] });
    await answer(slots[1], gs[1], "CHANGE_REQUESTED", { preferredSlotId: slots[0] });
    await reviewMeetingChange(slots[0], true, null, PRINCIPAL, NOW);
    const other = (await myMeetingSlots(gs[1], NOW))[0];
    expect([other.response?.reviewOutcome, other.response?.reviewSeenAt, other.slotTime]).toEqual(["APPROVED", null, 600]);
  });
});

describe("meetingResponseSummary", () => {
  it("counts every kind of answer", async () => {
    const { m, gs, slots } = await fourFamilies();
    await answer(slots[0], gs[0], "CONFIRMED");
    await answer(slots[1], gs[1], "CANT_COME");
    await answer(slots[2], gs[2], "CHANGE_REQUESTED", { preferredSlotId: slots[0] });
    expect(await meetingResponseSummary(m.toString())).toEqual({
      meetingId: m.toString(),
      total: 4,
      confirmed: 1,
      changePending: 1,
      changeApproved: 0,
      changeDeclined: 0,
      cantCome: 1,
      noAnswer: 1,
    });
  });
});
