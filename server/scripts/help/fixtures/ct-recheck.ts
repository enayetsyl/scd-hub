/**
 * Example data for the unusual-mark recheck guides (specs/ct-recheck.cjs; CT-RC, D-#1265–#1268).
 *
 * Create-only, LOCAL ONLY: it refuses any database that is not an in-memory one
 * (mongodb://127.0.0.1:<port>/). Built on seedBaseSchool(); every name is an example.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/ct-recheck.ts [--reset]
 *
 * ৩য় বালিকা ইংরেজি (teacher2): three published tests where নাফিসা scores ~12/20 and সাদিয়া
 * ~16/20, then
 *   - টেস্ট ৪ — draft: নাফিসা 20/20 (high + full), সাদিয়া 7/20 (low) → the teacher's ticks;
 *   - টেস্ট ৫ — submitted, নাফিসা ticked with a note → the approver's review;
 *   - টেস্ট ৬ — approved with নাফিসা HELD → the Principal's Today card.
 * ৫ম ক ইংরেজি (teacher2): three tests at ~11/20, then a draft at ~16–18/20 → the whole-class flag.
 */
import mongoose, { Types } from "mongoose";
import { seedBaseSchool } from "../fixture";
import { RoutineSlot } from "../../../src/modules/routine/models/RoutineSlot";
import { StoredFile } from "../../../src/modules/platform/models/StoredFile";
import * as CT from "../../../src/modules/trackers/services/ClassTestService";
import * as CTR from "../../../src/modules/trackers/services/ClassTestResultService";
import * as CTP from "../../../src/modules/trackers/services/ClassTestPublishService";
import * as RC from "../../../src/modules/trackers/services/ClassTestRecheckService";
import * as RCH from "../../../src/modules/trackers/services/ClassTestRecheckHoldService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

export async function seedCtRecheck() {
  const base = await seedBaseSchool();
  const U = base.users;
  const S = base.sections;
  const C = base.classes;
  const st = base.students;
  const P = String(U.principal);
  const T2 = String(U.teacher2);

  const slot = (sectionId: Types.ObjectId, classId: Types.ObjectId, subject: string, teacherId: Types.ObjectId, period: number) =>
    ["SUN", "MON", "TUE", "WED", "THU"].map((dayOfWeek) => ({
      groupType: "section", groupId: sectionId, classId, dayOfWeek, periodNumber: period, subject, track: "general",
      isBreak: false, teacherId, effectiveFrom: new Date("2026-01-01"), active: true, createdBy: U.principal,
    }));
  await RoutineSlot.create([...slot(S.c3Girls, C.c3, "ENG", U.teacher2, 1), ...slot(S.c5, C.c5, "ENG", U.teacher2, 1)]);

  async function register(sectionId: Types.ObjectId, testNumber: number, examDate: string) {
    const f = await StoredFile.create({
      kind: "classtest_question", mime: "application/pdf", sizeBytes: 120_000, originalName: `ENG-CT${testNumber}.pdf`,
      driveFileId: `local-example-${new Types.ObjectId().toString()}`, uploadedBy: U.teacher2,
    });
    const t = await CT.createRequest({
      sectionId: String(sectionId), subject: "ENG", source: "UPLOADED_PAPER", questionFileId: String(f._id), examDate,
      totalMarks: 20, testNumber, skipPrint: true, teacherId: T2, actorId: T2,
    });
    return t.id;
  }
  async function enter(testId: string, kids: Types.ObjectId[], marks: number[]) {
    for (const [i, sid] of kids.entries()) {
      await CTR.enterResult({ testId, studentId: String(sid), status: "PRESENT", marks: marks[i], actorId: T2 });
    }
  }
  async function publishedTest(sectionId: Types.ObjectId, kids: Types.ObjectId[], n: number, date: string, marks: number[]) {
    const id = await register(sectionId, n, date);
    await enter(id, kids, marks);
    await CTP.submitExam(id, T2);
    await CTP.approveExam(id, P, { flagsReviewed: true });
    return id;
  }

  // ── ৩য় বালিকা ইংরেজি ──────────────────────────────────────────────────────
  const girls = st.c3Girls;
  const usual = [12, 16, 14, 14, 13, 15];
  for (const [i, d] of ["2026-10-06", "2026-10-13", "2026-10-20"].entries()) await publishedTest(S.c3Girls, girls, i + 1, d, usual);

  // টেস্ট ৬ — approved with নাফিসা held (the Principal's Today card).
  const t6 = await register(S.c3Girls, 6, "2026-11-05");
  await enter(t6, girls, [20, 15, 14, 14, 13, 15]);
  await RC.confirmRecheck({ testId: t6, studentId: String(girls[0]), confirmed: true, note: "এই অধ্যায়টি ভালো পড়েছে", actorId: T2 });
  await CTP.submitExam(t6, T2, { scriptReminderAck: true });
  await RCH.setRecheckHold(t6, String(girls[0]), true, P);
  await CTP.approveExam(t6, P, { flagsReviewed: true });

  // টেস্ট ৫ — submitted with নাফিসা ticked (the approver's review).
  const t5 = await register(S.c3Girls, 5, "2026-11-04");
  await enter(t5, girls, [20, 15, 14, 14, 13, 15]);
  await RC.confirmRecheck({ testId: t5, studentId: String(girls[0]), confirmed: true, note: "এই অধ্যায়টি ভালো পড়েছে", actorId: T2 });
  await CTP.submitExam(t5, T2, { scriptReminderAck: true });

  // টেস্ট ৪ — draft with two unusual marks (the teacher's ticks).
  const t4 = await register(S.c3Girls, 4, "2026-11-03");
  await enter(t4, girls, [20, 7, 14, 14, 13, 15]);

  // ── ৫ম ক ইংরেজি — the whole class far above its usual level ─────────────────
  const c5 = st.c5;
  const c5usual = [10, 11, 12, 10, 11, 12];
  for (const [i, d] of ["2026-10-07", "2026-10-14", "2026-10-21"].entries()) await publishedTest(S.c5, c5, i + 1, d, c5usual);
  const c5t4 = await register(S.c5, 4, "2026-11-04");
  await enter(c5t4, c5, [16, 17, 16, 17, 16, 18]);

  return { ...base, t4, t5, t6, c5t4 };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedCtRecheck();
    console.log("fixture: ct-recheck (unusual marks: draft, submitted, held, whole class)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
