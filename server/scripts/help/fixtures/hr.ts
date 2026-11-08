/**
 * HR area example data for LOCAL help-guide capture runs (prd-help-centre §5), built on
 * the base school (scripts/help/fixture.ts → seedBaseSchool()).
 *
 * Create-only, and it refuses any database that is not a local in-memory one. Every
 * person here is an example. Data is written through the app's REAL services wherever
 * one exists, so each screen shows a real state:
 *   - HR policy (leave pool 15 days, signatory and letterhead), confirmation dates
 *     (teacher2 = still on probation), a support staff member with no login;
 *   - teacher's routine (Mon/Tue periods) so a leave fans out real cover slots;
 *   - leave: teacher — one approved (Oct), one applied (next Mon–Tue, cover proposed);
 *     teacher2 — one applied (pending approval);
 *   - letters (teacher: confirmation + certificate), a grievance, a conduct step;
 *   - biometric attendance days for every staff member (Oct–Nov);
 *   - staff mistakes: teacher has two waiting for a reason; teacher2 has one waiting for
 *     review and four counted (which raise a warning);
 *   - classroom observations: assigned to teacher2 (review queue), published to teacher
 *     (reply), reviewed-not-published on teacher2 (publish);
 *   - one exit case for the support staff member.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/hr.ts [--reset]
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { StaffProfile } from "../../../src/modules/foundation/models/StaffProfile";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { TeacherAttendanceDay } from "../../../src/modules/attendance/models/TeacherAttendanceDay";
import { setHrPolicy } from "../../../src/modules/hr/services/HrPolicyService";
import { applyForLeave, decideLeave } from "../../../src/modules/hr/services/StaffLeaveService";
import { proposeCover } from "../../../src/modules/hr/services/CoverService";
import { StaffCoverSlot } from "../../../src/modules/hr/models/StaffCoverSlot";
import { issueLetter } from "../../../src/modules/hr/services/StaffLetterService";
import { raiseGrievance } from "../../../src/modules/hr/services/GrievanceService";
import { recordConductStep } from "../../../src/modules/hr/services/ConductService";
import { initiateOffboarding } from "../../../src/modules/hr/services/OffboardingService";
import { upsertAppraisal, signOffAppraisal } from "../../../src/modules/hr/services/PerformanceService";
import { recordMistakeFromSource, explainMistake } from "../../../src/modules/staff-mistakes/services/StaffMistakeService";
import { scheduleMeeting } from "../../../src/modules/staff-mistakes/services/StaffWarningService";
import { StaffWarning } from "../../../src/modules/staff-mistakes/models/StaffWarning";
import {
  uploadObservation,
  reviewObservation,
  publishObservation,
} from "../../../src/modules/classroom-observation/services/ClassroomObservationService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

const ref11 = (strength: string, focus: string) => ({
  domains: ["D1", "D2", "D3", "D4", "D5"].map((domain, i) => ({
    domain,
    level: [3, 2, 3, 4, 3][i],
    note: [
      "পাঠের শুরুতে লক্ষ্য বোর্ডে লেখা ছিল।",
      "প্রশ্ন বেশিরভাগ সামনের সারির শিক্ষার্থীদের কাছে গেছে।",
      "দলগত কাজে সবাই অংশ নিয়েছে।",
      "শ্রেণিকক্ষ শান্ত ও গোছানো ছিল।",
      "শেষে ছোট মূল্যায়ন করা হয়েছে।",
    ][i],
  })),
  gates: [
    { gate: "G1", result: "PASS" },
    { gate: "G2", result: "PASS" },
  ],
  oneStrength: strength,
  growthFocus: focus,
});

async function seedHr() {
  const base = await seedBaseSchool();
  const { users, sections, yearId } = base;
  const P = users.principal.toString();

  // ── Staff records: designations, joining/confirmation dates, one probationer ──
  const byPhone = async (phone: string) => (await StaffProfile.findOne({ phone }))!;
  const sp = {
    principal: await byPhone("01700000001"),
    office: await byPhone("01700000002"),
    teacher: await byPhone("01700000003"),
    teacher2: await byPhone("01700000004"),
    reviewer: await byPhone("01700000005"),
  };
  const details: Record<keyof typeof sp, Record<string, unknown>> = {
    principal: { designation: "প্রধান শিক্ষক", joiningDate: new Date("2020-01-01"), confirmationDate: new Date("2020-07-01"), monthlySalary: 40000 },
    office: { designation: "অফিস সহকারী", joiningDate: new Date("2022-03-01"), confirmationDate: new Date("2022-09-01"), monthlySalary: 18000 },
    teacher: { designation: "সহকারী শিক্ষক", joiningDate: new Date("2023-01-01"), confirmationDate: new Date("2023-07-01"), monthlySalary: 22000 },
    teacher2: { designation: "সহকারী শিক্ষক", joiningDate: new Date("2026-05-01"), employmentStatus: "probation", monthlySalary: 20000 },
    reviewer: { designation: "জ্যেষ্ঠ শিক্ষক", joiningDate: new Date("2021-01-01"), confirmationDate: new Date("2021-07-01"), monthlySalary: 26000 },
  };
  for (const [k, v] of Object.entries(details)) await StaffProfile.updateOne({ _id: sp[k as keyof typeof sp]._id }, { $set: v });
  const support = await StaffProfile.create({
    schoolId: "S-06", name: "উদাহরণ সহায়ক কর্মী", phone: "01700000006", category: "support", designation: "সহায়ক কর্মী",
    employmentType: "full_time", employmentStatus: "confirmed", gender: "female", active: true,
    joiningDate: new Date("2024-02-01"), confirmationDate: new Date("2024-08-01"), monthlySalary: 9000,
  });
  const guard = await StaffProfile.create({
    schoolId: "S-07", name: "উদাহরণ দারোয়ান", phone: "01700000007", category: "support", designation: "দারোয়ান",
    employmentType: "full_time", employmentStatus: "confirmed", gender: "male", active: true,
    joiningDate: new Date("2024-06-01"), confirmationDate: new Date("2024-12-01"), monthlySalary: 9000,
  });

  await setHrPolicy({
    annualLeaveDays: 15,
    probationDebtEnabled: true,
    probationMonths: 6,
    latenessRuleEnabled: false,
    lateDaysPerCharge: 3,
    signatoryName: "Example Principal",
    signatoryTitle: "Principal",
    weeklyHoursText: "৩৬ ঘণ্টা",
    letterRefPrefix: "EX",
    orgRegistrationNo: "EX-0001",
    orgAddress: "Example Road, Example Town",
    orgPhone: "01700000000",
    orgEmail: "office@example.test",
    schoolBankName: "উদাহরণ ব্যাংক",
    schoolBankBranch: "উদাহরণ শাখা",
    schoolAccountNo: "0000000000",
    employerNameBn: "উদাহরণ স্কুল",
    employerAddressBn: "উদাহরণ সড়ক, উদাহরণ শহর",
    signatoryNameBn: "উদাহরণ অধ্যক্ষ",
    signatoryTitleBn: "প্রধান শিক্ষক",
    actorId: P,
  });

  // ── The teacher's routine (Mon: periods 1 and 3, Tue: period 2), so a leave fans out cover ──
  const slot = (dayOfWeek: string, periodNumber: number, subject: string) => ({
    groupType: "section", groupId: sections.c3Boys, classId: base.classes.c3, dayOfWeek, periodNumber, subject,
    track: "general", teacherId: users.teacher, effectiveFrom: new Date("2026-01-01"), active: true, createdBy: users.principal,
  });
  await RoutineSlot.create([slot("MON", 1, "MATH"), slot("MON", 3, "BAN"), slot("TUE", 2, "MATH"), slot("SUN", 2, "MATH"), slot("WED", 1, "BAN")]);

  // ── Leave ──
  const past = await applyForLeave({
    staffProfileId: sp.teacher._id.toString(), leaveType: "casual", fromKey: "2026-10-20", toKey: "2026-10-20",
    reason: "পারিবারিক প্রয়োজন", actorId: users.teacher.toString(),
  });
  await decideLeave(past._id.toString(), "approve", P);
  const upcoming = await applyForLeave({
    staffProfileId: sp.teacher._id.toString(), leaveType: "sick", fromKey: "2026-11-09", toKey: "2026-11-10",
    reason: "জ্বর — ডাক্তার দুই দিন বিশ্রাম নিতে বলেছেন", actorId: users.teacher.toString(),
  });
  const firstSlot = await StaffCoverSlot.findOne({ leaveApplicationId: upcoming._id }).sort({ dateKey: 1, periodNumber: 1 });
  if (firstSlot) await proposeCover(firstSlot._id.toString(), users.teacher2.toString(), users.teacher.toString());
  await applyForLeave({
    staffProfileId: sp.teacher2._id.toString(), leaveType: "casual", fromKey: "2026-11-12", toKey: "2026-11-12",
    reason: "ভাইয়ের বিয়ে", actorId: users.teacher2.toString(),
  });

  // ── Letters ──
  await issueLetter({
    staffProfileId: sp.teacher._id.toString(), kind: "confirmation", effectiveFrom: "2023-07-01", letterDate: "2023-07-01",
    salaryMode: "paid", actorId: P,
  });
  await issueLetter({
    staffProfileId: sp.teacher._id.toString(), kind: "service_certificate", effectiveFrom: "2023-01-01", letterDate: "2026-10-15",
    salaryMode: "paid", actorId: P,
  });

  // ── Grievance, conduct ──
  await raiseGrievance({
    raisedByStaffProfileId: sp.teacher._id.toString(), subject: "শ্রেণিকক্ষের পাখা নষ্ট",
    detail: "৩য় শ্রেণি বালক শাখার কক্ষের দুটি পাখা এক সপ্তাহ ধরে চলছে না।", actorId: users.teacher.toString(),
  });
  await recordConductStep({
    staffProfileId: sp.teacher2._id.toString(), stage: "verbal", issue: "পরপর তিন দিন দেরিতে ক্লাসে আসা", category: "সময়ানুবর্তিতা",
    actorId: P,
  });

  // The teacher's signed-off appraisal for the year (its development need also lands in the CPD log).
  const appraisal = await upsertAppraisal({
    staffProfileId: sp.teacher._id.toString(), academicYearId: yearId.toString(),
    goals: ["প্রতি সপ্তাহে পাঠ পরিকল্পনা জমা দেওয়া", "দুর্বল শিক্ষার্থীদের জন্য আলাদা অনুশীলন"],
    developmentNeeds: ["দলগত কাজ পরিচালনা"], actorId: P,
  });
  await signOffAppraisal({ appraisalId: appraisal._id.toString(), outcome: "meets", outcomeNote: "ভালো অগ্রগতি", actorId: P });

  // ── Biometric attendance (Oct 1 – Nov 5, school days) ──
  const rows: Array<Record<string, unknown>> = [];
  const allStaff = [sp.principal, sp.office, sp.teacher, sp.teacher2, sp.reviewer, support, guard];
  for (let d = new Date("2026-10-01T06:00:00Z"); d <= new Date("2026-11-05T06:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 5 || dow === 6) continue;
    const dateKey = d.toISOString().slice(0, 10);
    allStaff.forEach((s, i) => {
      const day = d.getUTCDate();
      const late = (day + i) % 7 === 0;
      const absent = (day + i) % 13 === 0 && dateKey !== "2026-10-20";
      const onLeave = s._id.equals(sp.teacher._id) && dateKey === "2026-10-20";
      rows.push({
        staffProfileId: s._id, dateKey, importedBy: users.office,
        status: onLeave ? "LEAVE" : absent ? "ABSENT" : late ? "LATE" : "PRESENT",
        punchIn: onLeave || absent ? undefined : late ? "07:24 AM" : `06:${String(40 + ((day + i) % 15)).padStart(2, "0")} AM`,
        punchOut: onLeave || absent ? undefined : "01:10 PM",
        shift: "Morning Shift 7:00-13:00",
      });
    });
  }
  await TeacherAttendanceDay.insertMany(rows);

  // ── Staff mistakes ──
  const at = (s: string) => new Date(`${s}T09:00:00+06:00`);
  const mk = (staffUserId: Types.ObjectId, kind: "TASK_OVERDUE" | "ATTENDANCE_NOT_MARKED", day: string, tier = 3) =>
    recordMistakeFromSource({ kind, tier, sourceId: new Types.ObjectId(), staffUserId, correctedBy: P, at: at(day) });
  const now = new Date();
  await mk(users.teacher, "ATTENDANCE_NOT_MARKED", now.toISOString().slice(0, 10));
  await mk(users.teacher, "TASK_OVERDUE", now.toISOString().slice(0, 10));
  const pending = await mk(users.teacher2, "ATTENDANCE_NOT_MARKED", now.toISOString().slice(0, 10));
  if (pending) {
    await explainMistake({
      mistakeId: pending._id.toString(), actorId: users.teacher2.toString(), reasonCode: "APP_PROBLEM",
      reasonText: "সকালে স্কুলের ওয়াইফাই বন্ধ ছিল, তাই জমা হয়নি।",
    });
  }
  for (const day of ["2026-10-26", "2026-10-28", "2026-11-01", "2026-11-03"]) {
    const m = await mk(users.teacher2, "TASK_OVERDUE", day);
    if (m) await explainMistake({ mistakeId: m._id.toString(), actorId: users.teacher2.toString(), reasonCode: "FORGOT", reasonText: "", now: at(day) });
  }
  // Two tier-1 slips the person admits, so the warning ladder fires (the summary's meeting steps).
  for (const day of ["2026-11-02", "2026-11-04", "2026-11-05"]) {
    const m = await recordMistakeFromSource({
      kind: "STAFF_LETTER_VOID", tier: 1, sourceId: new Types.ObjectId(), staffUserId: users.teacher2, correctedBy: P, at: at(day),
    });
    if (m) await explainMistake({ mistakeId: m._id.toString(), actorId: users.teacher2.toString(), reasonCode: "WRONG_DETAIL", reasonText: "", now: at(day) });
  }
  // The face-to-face step is booked (the summary's meeting card). Staff never see a warning (D-#1150).
  const meetingStep = await StaffWarning.findOne({ staffUserId: users.teacher2, step: "MEETING" });
  if (meetingStep) {
    await scheduleMeeting({ warningId: meetingStep._id.toString(), actorId: P, at: "2026-11-10T12:30:00+06:00", place: "প্রধান শিক্ষকের কক্ষ" });
  }

  // ── Classroom observations ──
  const T = users.teacher.toString(), T2 = users.teacher2.toString(), R = users.reviewer.toString();
  await uploadObservation({
    form: "REF11", subject: "MATH", teacherId: T, classDate: "2026-11-03", sectionId: sections.c3Boys.toString(), periodNumber: 2,
    observerId: T2, actorId: P,
  });
  const published = await uploadObservation({
    form: "REF11", subject: "BAN", teacherId: T, classDate: "2026-10-22", sectionId: sections.c3Boys.toString(), periodNumber: 3,
    observerId: R, actorId: P,
  });
  await reviewObservation({
    observationId: published.id, actorId: R,
    ...ref11("শিক্ষার্থীদের নাম ধরে প্রশ্ন করেছেন — সবাই মনোযোগী ছিল।", "পেছনের সারির শিক্ষার্থীদেরও প্রশ্নে যুক্ত করুন।"),
  });
  await publishObservation({ observationId: published.id, actorId: P });
  const toPublish = await uploadObservation({
    form: "REF11", subject: "ENG", teacherId: T2, classDate: "2026-11-02", sectionId: sections.c3Girls.toString(), periodNumber: 1,
    observerId: R, actorId: P,
  });
  await reviewObservation({
    observationId: toPublish.id, actorId: R,
    ...ref11("ছবি দেখিয়ে নতুন শব্দ শিখিয়েছেন।", "শেষে পাঁচ মিনিটের পুনরালোচনা রাখুন।"),
  });

  // ── Exit case ──
  await initiateOffboarding({
    staffProfileId: support._id.toString(), trigger: "resignation", lastWorkingDayKey: "2026-11-30", noticeDateKey: "2026-11-01", actorId: P,
  });

  return { ...base, yearId, staffProfiles: { ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, v._id])), support: support._id, guard: guard._id } };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedHr();
    console.log("fixture: base school + HR (policy, leave, cover, letters, attendance, mistakes, observations, exit case)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
