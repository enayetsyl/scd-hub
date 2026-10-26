/**
 * D-#852–#858 — pop-up notices (docs/prd-popup-notice.md).
 *
 *   rules        auto-close never with a lock; answer-required needs a button and hides ✕;
 *                a notice with no way to close is refused
 *   audience     every staff dimension (role, current = probation + confirmed, gender with
 *                missing-gender count, class taught via a section slot AND via a Quran group's
 *                members, subject, class teacher); guardians by class and by section; two
 *                children → one guardian; no login → unreachable; no guardian → a STUDENT
 *                row; hand-picked staff and families union with the filters
 *   permissions  each half of the audience needs its own send action
 *   publish      frozen recipient rows; a second publish is refused
 *   queue        once / daily / every_open / window; answer-required first; three quick at
 *                most; personalised; not before the start; gone when withdrawn; test rows
 *   events       monotonic; close-by-✕ refused on answer-required; auto-close refused on a
 *                locked one; answers final unless the sender allowed changes; snooze limit;
 *                done on one device = done on all
 *   sender       report counts, per-person filters + wa.me links, remind, add new matches,
 *                live edit with reshow, saved lists, আমার বার্তা history
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { AppContext } from "../context";
import { User } from "../modules/foundation/models/User";
import { StaffProfile } from "../modules/foundation/models/StaffProfile";
import { Class } from "../modules/foundation/models/Class";
import { Section } from "../modules/foundation/models/Section";
import { Student } from "../modules/foundation/models/Student";
import { Guardian } from "../modules/foundation/models/Guardian";
import { GuardianLink } from "../modules/foundation/models/GuardianLink";
import { RoutineSlot } from "../modules/routine/models/RoutineSlot";
import { SubjectGroup } from "../modules/routine/models/SubjectGroup";
import { SubjectGroupMembership } from "../modules/routine/models/SubjectGroupMembership";
import { PopupNotice } from "../modules/popup-notices/models/PopupNotice";
import { PopupNoticeRecipient } from "../modules/popup-notices/models/PopupNoticeRecipient";
import { PopupAudienceList } from "../modules/popup-notices/models/PopupAudienceList";
import { normalizeAudience, pickedPeople, previewAudience, resolveAudience, searchPopupPeople } from "../modules/popup-notices/services/PopupAudienceService";
import {
  PopupNoticeError,
  addPopupMatches,
  deletePopupAudienceList,
  duplicatePopupNotice,
  editLiveNotice,
  isDue,
  myPopupHistoryPage,
  myPopupQueue,
  normalizeRules,
  personalize,
  popupAudienceListsPage,
  popupNoticeReport,
  popupRecipientsPage,
  publishPopupNotice,
  recordPopupEvent,
  remindPopupNotice,
  savePopupAudienceList,
  savePopupDraft,
  sendPopupTestToMe,
  withdrawPopupNotice,
  type PopupNoticeInput,
} from "../modules/popup-notices/services/PopupNoticeService";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const NOW = new Date("2026-10-26T04:00:00.000Z"); // 10:00 Dhaka, Monday 26 Oct
const LATER_SAME_DAY = new Date("2026-10-26T09:00:00.000Z");
const NEXT_DAY = new Date("2026-10-27T04:00:00.000Z");
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
  await Promise.all(
    [User, StaffProfile, Class, Section, Student, Guardian, GuardianLink, RoutineSlot, SubjectGroup, SubjectGroupMembership, PopupNotice, PopupNoticeRecipient, PopupAudienceList].map(
      (m) => (m as unknown as mongoose.Model<unknown>).deleteMany({}),
    ),
  );
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ctxOf = (userId: string, role: string, extra: Record<string, unknown> = {}): AppContext =>
  ({ auth: { userId, role, ...extra } } as unknown as AppContext);

async function user(name: string, role: string, profile?: { gender?: string; status?: string }): Promise<string> {
  seq += 1;
  const phone = `88017000${String(seq).padStart(5, "0")}`;
  const r = await User.collection.insertOne({ name, role, phone, passwordHash: "x", active: true, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] });
  if (profile) {
    await StaffProfile.collection.insertOne({
      schoolId: `ST-${seq}`,
      name,
      category: "teacher",
      employmentType: "full_time",
      employmentStatus: profile.status ?? "confirmed",
      phone,
      ...(profile.gender ? { gender: profile.gender } : {}),
      active: true,
    });
  }
  return r.insertedId.toString();
}

async function klass(level: number): Promise<Types.ObjectId> {
  const r = await Class.collection.insertOne({ level, nameBn: `L${level}`, academicYearId: new Types.ObjectId(), active: true });
  return r.insertedId;
}

async function section(classId: Types.ObjectId, code: string, nameBn: string, classTeacherId?: string): Promise<Types.ObjectId> {
  const r = await Section.collection.insertOne({ classId, code, nameBn, active: true, ...(classTeacherId ? { classTeacherId: new Types.ObjectId(classTeacherId) } : {}) });
  return r.insertedId;
}

async function student(name: string, classId: Types.ObjectId, sectionId: Types.ObjectId, phone = ""): Promise<Types.ObjectId> {
  seq += 1;
  const r = await Student.collection.insertOne({ schoolId: `S-${seq}`, name, classId, sectionId, active: true, ...(phone ? { phone } : {}) });
  return r.insertedId;
}

async function guardian(name: string, kids: Types.ObjectId[], loginEnabled = true): Promise<string> {
  seq += 1;
  const r = await Guardian.collection.insertOne({ identifierKind: "phone", identifier: `0190000${seq}`, name, phone: `8801900000${seq}`, loginEnabled, active: true });
  for (const k of kids) await GuardianLink.collection.insertOne({ guardianId: r.insertedId, studentId: k, relation: "mother", active: true });
  return r.insertedId.toString();
}

async function slot(teacherId: string, groupType: "section" | "subjectgroup", groupId: Types.ObjectId, subject: string, classId?: Types.ObjectId): Promise<void> {
  await RoutineSlot.collection.insertOne({
    groupType,
    groupId,
    ...(classId ? { classId } : {}),
    dayOfWeek: "SUN",
    periodNumber: ++seq,
    subject,
    track: groupType === "section" ? "general" : "quran",
    isBreak: false,
    teacherId: new Types.ObjectId(teacherId),
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    active: true,
    createdBy: new Types.ObjectId(),
  });
}

function input(over: Partial<PopupNoticeInput> = {}): PopupNoticeInput {
  return {
    titleBn: "আসসালামু আলাইকুম {নাম}",
    bodyBn: "{সন্তান} ({শ্রেণি}) — আগামীকাল ছুটি।",
    audience: { guardian: { classLevels: [] } },
    rules: { autoCloseSec: 5, closeButton: true },
    actions: [],
    endsOn: "2026-11-02",
    repeat: "daily",
    ...over,
  };
}

/** A school: KG (one section) + Class 3 Boys/Girls, staff with routine slots, families. */
async function school() {
  const principal = await user("Principal", "PRINCIPAL", { gender: "male" });
  const office = await user("Office", "OFFICE", { gender: "female" });
  const kgF = await user("KG Female", "TEACHER", { gender: "female" });
  const kgM = await user("KG Male", "TEACHER", { gender: "male", status: "probation" });
  const c3F = await user("C3 Female", "TEACHER", { gender: "female" });
  const quran = await user("Quran Teacher", "TEACHER", { gender: "male" });
  const resigned = await user("Resigned", "TEACHER", { gender: "female", status: "resigned" });
  const noProfile = await user("No Profile", "TEACHER");

  const kg = await klass(0);
  const c3 = await klass(3);
  const kgMain = await section(kg, "Main", "প্রধান", kgF);
  const c3Boys = await section(c3, "Boys", "বালক");
  const c3Girls = await section(c3, "Girls", "বালিকা", c3F);
  await slot(kgF, "section", kgMain, "BAN", kg);
  await slot(kgM, "section", kgMain, "ENG", kg);
  await slot(c3F, "section", c3Girls, "MATH", c3);
  await slot(resigned, "section", c3Boys, "ENG", c3);

  const ayesha = await student("Ayesha", kg, kgMain, "8801711111111");
  const rafi = await student("Rafi", c3, c3Boys);
  const zara = await student("Zara", c3, c3Girls);
  const orphan = await student("Orphan", c3, c3Girls, "8801722222222");

  // A Quran group whose members are a KG child and a Class 3 child: its teacher teaches both.
  const grp = await SubjectGroup.collection.insertOne({ track: "quran", level: "Qaida", gender: "mixed", code: `Q-${seq}`, nameBn: "কায়দা", active: true });
  await SubjectGroupMembership.collection.insertOne({ groupId: grp.insertedId, studentId: ayesha, track: "quran" });
  await SubjectGroupMembership.collection.insertOne({ groupId: grp.insertedId, studentId: rafi, track: "quran" });
  await slot(quran, "subjectgroup", grp.insertedId, "QURAN");

  const gAyeshaRafi = await guardian("Two Kids Mum", [ayesha, rafi]);
  const gZara = await guardian("Zara Mum", [zara], false);
  return { principal, office, kgF, kgM, c3F, quran, resigned, noProfile, kg, c3, kgMain, c3Boys, c3Girls, ayesha, rafi, zara, orphan, gAyeshaRafi, gZara };
}

const ids = (rs: Array<{ id: Types.ObjectId }>) => rs.map((r) => r.id.toString()).sort();

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

describe("close rules", () => {
  test("auto-close is never combined with a lock", () => {
    expect(() => normalizeRules({ autoCloseSec: 5, mustScrollToEnd: true }, 0)).toThrow(PopupNoticeError);
    expect(() => normalizeRules({ autoCloseSec: 5, minReadSec: 20 }, 0)).toThrow(PopupNoticeError);
    expect(() => normalizeRules({ autoCloseSec: 5, mustAct: true }, 1)).toThrow(PopupNoticeError);
  });
  test("answer-required needs a button and never shows ✕", () => {
    expect(() => normalizeRules({ mustAct: true }, 0)).toThrow(/অন্তত একটি বোতাম/);
    expect(normalizeRules({ mustAct: true, closeButton: true }, 2).closeButton).toBe(false);
  });
  test("a notice with no way to close is refused; ranges are enforced", () => {
    expect(() => normalizeRules({ closeButton: false }, 0)).toThrow(/বন্ধ করার কোনো উপায় নেই/);
    expect(() => normalizeRules({ autoCloseSec: 2 }, 0)).toThrow(PopupNoticeError);
    expect(() => normalizeRules({ minReadSec: 400 }, 0)).toThrow(PopupNoticeError);
    // Owner, 2026-10-26: the minimum reading time starts at 2 seconds.
    expect(normalizeRules({ minReadSec: 2 }, 0).minReadSec).toBe(2);
    expect(() => normalizeRules({ minReadSec: 1 }, 0)).toThrow(/২ থেকে ৩০০/);
    expect(normalizeRules({ mustScrollToEnd: true, minReadSec: 20 }, 0)).toMatchObject({ closeButton: true, mustScrollToEnd: true, minReadSec: 20 });
  });
  test("personalize fills Bangla and English merge fields", () => {
    expect(personalize("{নাম} / {name}: {সন্তান} {শ্রেণি}", { name: "Mum", childNames: ["A", "B"], classLabels: ["কেজি"] })).toBe("Mum / Mum: A ও B কেজি");
  });
});

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

describe("audience", () => {
  test("staff: role + current employment excludes the resigned; a login with no HR row is current", async () => {
    const s = await school();
    const r = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"] } }), NOW);
    expect(ids(r.recipients)).toEqual([s.kgF, s.kgM, s.c3F, s.quran, s.noProfile].sort());
  });

  test("staff: probation only / confirmed only", async () => {
    const s = await school();
    const p = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], employment: "probation" } }), NOW);
    expect(ids(p.recipients)).toEqual([s.kgM]);
    const c = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], employment: "confirmed" } }), NOW);
    expect(ids(c.recipients)).toEqual([s.kgF, s.c3F, s.quran].sort());
  });

  test("staff: gender — a teacher with no gender on file is counted, not silently matched", async () => {
    const s = await school();
    const r = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], genders: ["female"] } }), NOW);
    expect(ids(r.recipients)).toEqual([s.kgF, s.c3F].sort());
    expect(r.staffMissingGender).toBe(1);
  });

  test("staff: teaches KG — via a section slot and via a Quran group's members", async () => {
    const s = await school();
    const r = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], classLevels: [0] } }), NOW);
    expect(ids(r.recipients)).toEqual([s.kgF, s.kgM, s.quran].sort());
    const fem = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], classLevels: [0], genders: ["female"] } }), NOW);
    expect(ids(fem.recipients)).toEqual([s.kgF]);
  });

  test("staff: subject and class-teacher filters", async () => {
    const s = await school();
    const q = await resolveAudience(normalizeAudience({ staff: { subjects: ["QURAN"] } }), NOW);
    expect(ids(q.recipients)).toEqual([s.quran]);
    const ct = await resolveAudience(normalizeAudience({ staff: { roles: ["TEACHER"], classTeachersOnly: true } }), NOW);
    expect(ids(ct.recipients)).toEqual([s.kgF, s.c3F].sort());
  });

  test("staff: an empty staff filter is every current staff member; office only", async () => {
    const s = await school();
    const all = await resolveAudience(normalizeAudience({ staff: {} }), NOW);
    expect(all.staffCount).toBe(7); // 8 logins − the resigned one
    const off = await resolveAudience(normalizeAudience({ staff: { roles: ["OFFICE"] } }), NOW);
    expect(ids(off.recipients)).toEqual([s.office]);
  });

  test("guardians: one row per guardian with every matched child; no login → unreachable; no guardian → STUDENT row", async () => {
    const s = await school();
    const r = await resolveAudience(normalizeAudience({ guardian: {} }), NOW);
    const g = r.recipients.find((x) => x.id.toString() === s.gAyeshaRafi)!;
    expect(g.kind).toBe("GUARDIAN");
    expect(g.vars.childNames.sort()).toEqual(["Ayesha", "Rafi"]);
    expect(g.vars.classLabels.sort()).toEqual(["কেজি", "তৃতীয় শ্রেণি বালক"].sort());
    expect(r.recipients.find((x) => x.id.toString() === s.gZara)!.reachable).toBe(false);
    const orphan = r.recipients.find((x) => x.kind === "STUDENT")!;
    expect(orphan.id.toString()).toBe(s.orphan.toString());
    expect(orphan.vars.phone).toBe("8801722222222");
    expect(r.guardianCount).toBe(3);
    expect(r.unreachableCount).toBe(2);
  });

  test("guardians: by class level, by section (boys/girls), and the matched child only", async () => {
    const s = await school();
    const kg = await resolveAudience(normalizeAudience({ guardian: { classLevels: [0] } }), NOW);
    expect(ids(kg.recipients)).toEqual([s.gAyeshaRafi]);
    expect(kg.recipients[0].vars.childNames).toEqual(["Ayesha"]);
    const girls = await resolveAudience(normalizeAudience({ guardian: { sectionIds: [s.c3Girls.toString()] } }), NOW);
    expect(ids(girls.recipients)).toEqual([s.gZara, s.orphan.toString()].sort());
  });

  test("custom list: hand-picked staff and families union with a filter, deduplicated", async () => {
    const s = await school();
    const r = await resolveAudience(
      normalizeAudience({ staff: { roles: ["OFFICE"] }, userIds: [s.kgF, s.office], studentIds: [s.zara.toString()] }),
      NOW,
    );
    expect(ids(r.recipients)).toEqual([s.office, s.kgF, s.gZara].sort());
  });

  test("preview pages the names and describes the audience in Bangla", async () => {
    await school();
    const p = await previewAudience(normalizeAudience({ staff: { roles: ["TEACHER"], classLevels: [0] } }), { pageSize: 2 }, NOW);
    expect(p.total).toBe(3);
    expect(p.people.rows).toHaveLength(2);
    expect(p.people.total).toBe(3);
    expect(p.summary).toContain("কেজি");
  });

  test("people search finds staff by name and families by child", async () => {
    await school();
    const hits = await searchPopupPeople("zar");
    expect(hits.rows.map((h) => [h.kind, h.name])).toEqual([["STUDENT", "Zara"]]);
    const staff = await searchPopupPeople("KG");
    expect(staff.rows.filter((h) => h.kind === "USER")).toHaveLength(2);
  });

  test("✕ takes people out whatever matched them: staff, a guardian, a no-guardian family", async () => {
    const s = await school();
    const a = normalizeAudience({
      staff: { roles: ["TEACHER"], classLevels: [0] },
      guardian: {},
      userIds: [s.c3F],
      excludeUserIds: [s.kgM, s.c3F],
      excludeGuardianIds: [s.gZara],
      excludeStudentIds: [s.orphan.toString()],
    });
    const r = await resolveAudience(a, NOW);
    expect(ids(r.recipients)).toEqual([s.kgF, s.quran, s.gAyeshaRafi].sort());
    expect(r.excluded.map((x) => x.id.toString()).sort()).toEqual([s.kgM, s.c3F, s.gZara, s.orphan.toString()].sort());
    const p = await previewAudience(a, {}, NOW);
    expect(p.total).toBe(3);
    expect(p.excluded.map((x) => x.name).sort()).toEqual(["C3 Female", "KG Male", "Orphan", "Zara Mum"]);
    expect(p.summary).toContain("৪ জন বাদ");
  });

  test("an excluded person is not written at publish", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const d = await savePopupDraft(office, null, input({ audience: { staff: { roles: ["TEACHER"] }, excludeUserIds: [s.kgF] } }));
    expect(d.audience.excludeUserIds).toEqual([s.kgF]);
    await publishPopupNotice(office, d.id, NOW);
    expect(await PopupNoticeRecipient.countDocuments({ noticeId: d.id, recipientId: s.kgF })).toBe(0);
    expect(await myPopupQueue(ctxOf(s.kgF, "TEACHER"), NOW)).toHaveLength(0);
    expect(await myPopupQueue(ctxOf(s.kgM, "TEACHER"), NOW)).toHaveLength(1);
  });

  test("picked ids come back as names for the composer", async () => {
    const s = await school();
    const hits = await pickedPeople([s.kgF, "nope"], [s.zara.toString()]);
    expect(hits.map((h) => [h.kind, h.name, h.detail])).toEqual([
      ["USER", "KG Female", "শিক্ষক"],
      ["STUDENT", "Zara", expect.stringContaining("তৃতীয় শ্রেণি বালিকা")],
    ]);
  });

  test("bad input is refused in Bangla", () => {
    expect(() => normalizeAudience({ staff: { roles: ["GUARDIAN"] } })).toThrow(PopupNoticeError);
    expect(() => normalizeAudience({ guardian: { classLevels: [9] } })).toThrow(PopupNoticeError);
  });
});

// ---------------------------------------------------------------------------
// Permissions + publish
// ---------------------------------------------------------------------------

describe("permissions and publish", () => {
  test("each half of the audience needs its own send action", async () => {
    const s = await school();
    const staffOnly = ctxOf(s.kgF, "TEACHER", { grantedPermissions: ["popup_notice:send_staff"] });
    await expect(savePopupDraft(staffOnly, null, input({ audience: { staff: {} } }))).resolves.toBeTruthy();
    await expect(savePopupDraft(staffOnly, null, input({ audience: { staff: {}, studentIds: [s.zara.toString()] } }))).rejects.toThrow(/অভিভাবকদের/);
    const office = ctxOf(s.office, "OFFICE");
    await expect(savePopupDraft(office, null, input())).resolves.toBeTruthy();
  });

  test("publish freezes the audience; a second publish is refused; a later family is not added", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const d = await savePopupDraft(office, null, input());
    const p = await publishPopupNotice(office, d.id, NOW);
    expect(p.status).toBe("PUBLISHED");
    expect(p.displayStatus).toBe("LIVE");
    expect(p.recipientCount).toBe(3);
    expect(p.unreachableCount).toBe(2);
    await expect(publishPopupNotice(office, d.id, NOW)).rejects.toThrow(/আগেই পাঠানো/);
    const newKid = await student("New", s.kg, s.kgMain);
    await guardian("New Mum", [newKid]);
    expect(await PopupNoticeRecipient.countDocuments({ noticeId: d.id })).toBe(3);
    // …until the sender asks: add new matches.
    expect(await addPopupMatches(office, d.id, NOW)).toBe(1);
    expect(await addPopupMatches(office, d.id, NOW)).toBe(0);
  });

  test("an audience that matches nobody, or an end date already past, is not sent", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const none = await savePopupDraft(office, null, input({ audience: { staff: { roles: ["TEACHER"], subjects: ["SCI"] } } }));
    await expect(publishPopupNotice(office, none.id, NOW)).rejects.toThrow(/কেউ মেলেনি/);
    const past = await savePopupDraft(office, null, input({ endsOn: "2026-10-01" }));
    await expect(publishPopupNotice(office, past.id, NOW)).rejects.toThrow(/পেরিয়ে গেছে/);
  });
});

// ---------------------------------------------------------------------------
// Queue + events
// ---------------------------------------------------------------------------

async function sent(office: AppContext, over: Partial<PopupNoticeInput>, at = NOW) {
  const d = await savePopupDraft(office, null, input(over));
  return publishPopupNotice(office, d.id, at);
}

describe("queue", () => {
  test("isDue: once / daily / every_open / window", () => {
    const fresh = { pending: false, doneAt: null, lastShownDayKey: "", showCount: 0, test: false };
    const shownToday = { ...fresh, lastShownDayKey: "2026-10-26", showCount: 1 };
    const done = { ...shownToday, doneAt: new Date() };
    expect(isDue("once", fresh, "2026-10-26")).toBe(true);
    expect(isDue("once", shownToday, "2026-10-27")).toBe(false);
    expect(isDue("daily", shownToday, "2026-10-26")).toBe(false);
    expect(isDue("daily", shownToday, "2026-10-27")).toBe(true);
    expect(isDue("daily", done, "2026-10-27")).toBe(false);
    expect(isDue("every_open", shownToday, "2026-10-26")).toBe(true);
    expect(isDue("window", done, "2026-10-27")).toBe(true);
    expect(isDue("window", done, "2026-10-26")).toBe(false);
    expect(isDue("once", { ...done, pending: true }, "2026-10-26")).toBe(true);
  });

  test("personalised for the guardian; answer-required first; at most three quick-info", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    for (let i = 0; i < 4; i++) await sent(office, { titleBn: `Quick ${i}` });
    await sent(office, { titleBn: "Read me", rules: { mustScrollToEnd: true } });
    await sent(office, { titleBn: "Answer me", rules: { mustAct: true }, actions: [{ kind: "CHOICE", labelBn: "আসব" }, { kind: "CHOICE", labelBn: "পারব না" }] });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    const q = await myPopupQueue(me, NOW);
    // The fourth quick-info notice waits for the next app open.
    expect(q.map((x) => x.titleBn)).toEqual(["Answer me", "Read me", "Quick 0", "Quick 1", "Quick 2"]);
  });

  test("merge fields read the guardian's own children", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    await sent(office, { audience: { guardian: { classLevels: [0] } } });
    const [show] = await myPopupQueue(ctxOf(s.gAyeshaRafi, "GUARDIAN"), NOW);
    expect(show.titleBn).toBe("আসসালামু আলাইকুম Two Kids Mum");
    expect(show.bodyBn).toBe("Ayesha (কেজি) — আগামীকাল ছুটি।");
    expect(show.fromLabel).toBe("অফিস");
  });

  test("daily: once per school day until done; done on one device ends it everywhere", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { rules: { mustScrollToEnd: true } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    expect(await myPopupQueue(me, NOW)).toHaveLength(1);
    await recordPopupEvent(me, { noticeId: n.id, kind: "SEEN", device: "android" }, NOW);
    expect(await myPopupQueue(me, LATER_SAME_DAY)).toHaveLength(0);
    expect(await myPopupQueue(me, NEXT_DAY)).toHaveLength(1);
    await recordPopupEvent(me, { noticeId: n.id, kind: "SEEN", device: "web" }, NEXT_DAY);
    await recordPopupEvent(me, { noticeId: n.id, kind: "READ" }, NEXT_DAY);
    await recordPopupEvent(me, { noticeId: n.id, kind: "CLOSED", method: "button" }, NEXT_DAY);
    expect(await myPopupQueue(me, new Date("2026-10-28T04:00:00.000Z"))).toHaveLength(0);
    const row = await PopupNoticeRecipient.findOne({ noticeId: n.id, recipientId: s.gAyeshaRafi }).lean();
    expect(row).toMatchObject({ state: "READ", showCount: 2, closeMethod: "button" });
    expect(row!.deviceKinds.sort()).toEqual(["android", "web"]);
  });

  test("every_open and staff recipients; a scheduled notice waits for its start; withdrawn disappears", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { audience: { staff: { roles: ["TEACHER"] } }, repeat: "every_open", rules: { mustScrollToEnd: true } });
    const t = ctxOf(s.kgF, "TEACHER");
    await recordPopupEvent(t, { noticeId: n.id, kind: "SEEN" }, NOW);
    expect(await myPopupQueue(t, NOW)).toHaveLength(1);
    const later = await savePopupDraft(office, null, input({ audience: { staff: {} }, startsAt: "2026-10-27T01:00:00.000Z" }));
    await publishPopupNotice(office, later.id, NOW);
    expect((await myPopupQueue(t, NOW)).map((x) => x.noticeId)).toEqual([n.id]);
    expect((await myPopupQueue(t, NEXT_DAY)).map((x) => x.noticeId).sort()).toEqual([n.id, later.id].sort());
    await withdrawPopupNotice(office, n.id, NOW);
    expect(await myPopupQueue(t, NOW)).toHaveLength(0);
    await expect(recordPopupEvent(t, { noticeId: n.id, kind: "SEEN" }, NOW)).rejects.toThrow(/আর চলছে না/);
  });

  test("a guardian without a login, and a person outside the audience, get nothing", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, {});
    expect(await myPopupQueue(ctxOf(s.gZara, "GUARDIAN"), NOW)).toHaveLength(0);
    await expect(recordPopupEvent(ctxOf(s.kgF, "TEACHER"), { noticeId: n.id, kind: "SEEN" }, NOW)).rejects.toThrow(/আপনার জন্য নয়/);
  });
});

describe("events", () => {
  const choice = { rules: { mustAct: true }, actions: [{ kind: "CHOICE", labelBn: "আসব" }, { kind: "CHOICE", labelBn: "পারব না" }] };

  test("answer-required cannot be closed by ✕; the answer is final by default and audited once", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, choice);
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await expect(recordPopupEvent(me, { noticeId: n.id, kind: "CLOSED", method: "button" }, NOW)).rejects.toThrow(/উত্তর না দিয়ে/);
    const after = await recordPopupEvent(me, { noticeId: n.id, kind: "ACTED", choiceId: "a1" }, NOW);
    expect(after).toMatchObject({ state: "ACTED", choiceId: "a1", canChangeAnswer: false });
    await expect(recordPopupEvent(me, { noticeId: n.id, kind: "ACTED", choiceId: "a2" }, NOW)).rejects.toThrow(/বদলানো যাবে না/);
    await expect(recordPopupEvent(me, { noticeId: n.id, kind: "ACTED", choiceId: "zz" }, NOW)).rejects.toThrow(/উত্তরটি বার্তায় নেই/);
    expect(await myPopupQueue(me, NEXT_DAY)).toHaveLength(0);
  });

  test("the sender may allow an answer change", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { ...choice, rules: { mustAct: true, allowAnswerChange: true } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await recordPopupEvent(me, { noticeId: n.id, kind: "ACTED", choiceId: "a1" }, NOW);
    const changed = await recordPopupEvent(me, { noticeId: n.id, kind: "ACTED", choiceId: "a2" }, NOW);
    expect(changed).toMatchObject({ choiceId: "a2", canChangeAnswer: true });
  });

  test("auto-close is refused on a locked notice; state never moves backwards", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const locked = await sent(office, { rules: { minReadSec: 20, mustScrollToEnd: true } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await expect(recordPopupEvent(me, { noticeId: locked.id, kind: "CLOSED", method: "auto" }, NOW)).rejects.toThrow(/নিজে বন্ধ হয় না/);
    await recordPopupEvent(me, { noticeId: locked.id, kind: "READ", readMs: 21000 }, NOW);
    const back = await recordPopupEvent(me, { noticeId: locked.id, kind: "SEEN", readMs: 5000 }, NOW);
    expect(back!.state).toBe("READ");
    const row = await PopupNoticeRecipient.findOne({ noticeId: locked.id, recipientId: s.gAyeshaRafi }).lean();
    expect(row!.readMs).toBe(21000);

    const quick = await sent(office, {});
    const closed = await recordPopupEvent(me, { noticeId: quick.id, kind: "CLOSED", method: "auto" }, NOW);
    expect(closed!.state).toBe("SEEN"); // auto-close = seen, not read
  });

  test("snooze brings it back on the next open, up to the limit", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { rules: { mustScrollToEnd: true, allowSnooze: true, maxSnooze: 1 } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await recordPopupEvent(me, { noticeId: n.id, kind: "SEEN" }, NOW);
    await recordPopupEvent(me, { noticeId: n.id, kind: "SNOOZED" }, NOW);
    expect(await myPopupQueue(me, LATER_SAME_DAY)).toHaveLength(1);
    await expect(recordPopupEvent(me, { noticeId: n.id, kind: "SNOOZED" }, NOW)).rejects.toThrow(/আর পরে দেখার সুযোগ নেই/);
    const plain = await sent(office, { rules: { mustScrollToEnd: true } });
    await expect(recordPopupEvent(me, { noticeId: plain.id, kind: "SNOOZED" }, NOW)).rejects.toThrow(/সুযোগ নেই/);
  });

  test("test send: the sender alone sees it, even as a draft; it never reaches the report", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const d = await savePopupDraft(office, null, input());
    await sendPopupTestToMe(office, d.id);
    const q = await myPopupQueue(office, NOW);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ test: true, bodyBn: "(সন্তানের নাম) ((শ্রেণি)) — আগামীকাল ছুটি।" });
    await recordPopupEvent(office, { noticeId: d.id, kind: "CLOSED", method: "auto", test: true }, NOW);
    expect(await myPopupQueue(office, NOW)).toHaveLength(0);
    await publishPopupNotice(office, d.id, NOW);
    const report = await popupNoticeReport(d.id);
    expect(report.recipients).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sender: report, follow-ups, edits, lists, history
// ---------------------------------------------------------------------------

describe("sender", () => {
  test("report counts, choice tallies, groups; per-person filters with wa.me links", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const kidOnly = await student("Solo", s.kg, s.kgMain);
    const gSolo = await guardian("Solo Dad", [kidOnly]);
    const n = await sent(office, { rules: { mustAct: true }, actions: [{ kind: "CHOICE", labelBn: "আসব" }, { kind: "CHOICE", labelBn: "পারব না" }] });
    await recordPopupEvent(ctxOf(s.gAyeshaRafi, "GUARDIAN"), { noticeId: n.id, kind: "SEEN" }, NOW);
    await recordPopupEvent(ctxOf(s.gAyeshaRafi, "GUARDIAN"), { noticeId: n.id, kind: "ACTED", choiceId: "a1" }, NOW);
    const r = await popupNoticeReport(n.id);
    expect(r).toMatchObject({ recipients: 4, reachable: 2, unreachable: 2, seen: 1, acted: 1, done: 1, notSeen: 1 });
    expect(r.choices).toEqual([
      { id: "a1", label: "আসব", count: 1 },
      { id: "a2", label: "পারব না", count: 0 },
    ]);
    expect(r.groups.map((g) => g.group)).toContain("কেজি");

    const notSeen = await popupRecipientsPage(n.id, "not_seen");
    expect(notSeen.rows.map((x) => x.id)).toEqual([gSolo]);
    const unreachable = await popupRecipientsPage(n.id, "unreachable");
    expect(unreachable.total).toBe(2);
    const orphanRow = unreachable.rows.find((x) => x.kind === "STUDENT")!;
    expect(orphanRow.waLink).toMatch(/^https:\/\/wa\.me\/8801722222222\?text=/);
    expect(decodeURIComponent(orphanRow.waLink)).toContain("Orphan (তৃতীয় শ্রেণি বালিকা)");
    const yes = await popupRecipientsPage(n.id, "choice:a1");
    expect(yes.rows.map((x) => [x.id, x.choiceLabel])).toEqual([[s.gAyeshaRafi, "আসব"]]);
  });

  test("remind brings it back to everyone not done, whatever the repeat rule", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { repeat: "once", rules: { mustScrollToEnd: true } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await recordPopupEvent(me, { noticeId: n.id, kind: "SEEN" }, NOW);
    expect(await myPopupQueue(me, NEXT_DAY)).toHaveLength(0);
    expect(await remindPopupNotice(office, n.id)).toBe(1);
    expect(await myPopupQueue(me, LATER_SAME_DAY)).toHaveLength(1);
  });

  test("a live edit fixes the words, keeps the rules locked, and can re-show to everyone", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { rules: { mustScrollToEnd: true } });
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await recordPopupEvent(me, { noticeId: n.id, kind: "CLOSED", method: "button" }, NOW);
    await expect(savePopupDraft(office, n.id, input())).rejects.toThrow(/বদলানো যায় না/);
    const edited = await editLiveNotice(office, n.id, { titleBn: "Fixed", bodyBn: "New body", endsOn: "2026-11-05" }, NOW);
    expect(edited).toMatchObject({ titleBn: "Fixed", version: 2, endsOn: "2026-11-05" });
    expect(await myPopupQueue(me, NEXT_DAY)).toHaveLength(0);
    await editLiveNotice(office, n.id, { titleBn: "Important", bodyBn: "Changed", endsOn: "2026-11-05", reshow: true }, NOW);
    const [again] = await myPopupQueue(me, LATER_SAME_DAY);
    expect(again.titleBn).toBe("Important");
  });

  test("duplicate starts a fresh draft with the same audience and rules", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const n = await sent(office, { rules: { minReadSec: 30 } });
    const copy = await duplicatePopupNotice(office, n.id, NOW);
    expect(copy).toMatchObject({ status: "DRAFT", startsAt: null, endsOn: "2026-11-02" });
    expect(copy.rules.minReadSec).toBe(30);
    expect(copy.audience.guardian).toEqual({ classLevels: [], sectionIds: [] });
  });

  test("saved lists: save, list, delete; the send permissions apply", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const l = await savePopupAudienceList(office, null, "Sports-day volunteers", { userIds: [s.kgF], studentIds: [s.zara.toString()] });
    expect(l.summary).toContain("২ জন বাছাই করা");
    expect((await popupAudienceListsPage()).rows.map((x) => x.name)).toEqual(["Sports-day volunteers"]);
    const staffOnly = ctxOf(s.kgF, "TEACHER", { grantedPermissions: ["popup_notice:send_staff"] });
    await expect(deletePopupAudienceList(staffOnly, l.id)).rejects.toThrow(/অভিভাবকদের/);
    await deletePopupAudienceList(office, l.id);
    expect((await popupAudienceListsPage()).total).toBe(0);
    await expect(savePopupAudienceList(office, null, "Empty", {})).rejects.toThrow(PopupNoticeError);
  });

  test("আমার বার্তা: received notices, newest first, with the answer label", async () => {
    const s = await school();
    const office = ctxOf(s.office, "OFFICE");
    const a = await sent(office, { titleBn: "First", rules: { mustAct: true }, actions: [{ kind: "ACK", labelBn: "পড়েছি" }] }, NOW);
    const b = await sent(office, { titleBn: "Second" }, LATER_SAME_DAY);
    const me = ctxOf(s.gAyeshaRafi, "GUARDIAN");
    await recordPopupEvent(me, { noticeId: a.id, kind: "ACTED", choiceId: "a1" }, NOW);
    const h = await myPopupHistoryPage(me, {}, NEXT_DAY);
    expect(h.rows.map((r) => r.show.noticeId)).toEqual([b.id, a.id]);
    expect(h.rows[1]).toMatchObject({ choiceLabel: "পড়েছি", live: true });
  });
});
