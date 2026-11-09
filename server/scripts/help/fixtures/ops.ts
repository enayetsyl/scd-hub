/**
 * Example data for the `ops` help guides (getting started, messages, school operations,
 * printing, reports, admin): LOCAL capture runs only (prd-help-centre §5, HC-3).
 *
 * Create-only, built on the base school (../fixture.ts), and it refuses any database that is
 * not a local in-memory one. Every name is an example; no real person appears.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc npx tsx scripts/help/fixtures/ops.ts [--reset]
 *
 * Adds, through the app's own services where one exists:
 *   - notifications for the class teacher (teacher@help.test) and the base guardian;
 *   - three library books with copies (LIB-001 … LIB-004) and one loan (LIB-003 to তানভীর);
 *   - print requests from both teachers (৩য় বালক, ৩য় বালিকা, ৫ম, one with no class), one printed;
 *   - one script-archive box; a family phone on every student row (for the WhatsApp notice);
 *   - the automatic chat groups (school, sections), so বার্তা lists colleagues;
 *   - a staff record with no login yet ("উদাহরণ নতুন শিক্ষক"), for the create-login guide.
 */
import mongoose from "mongoose";
import { seedBaseSchool } from "../fixture";
import { emit } from "../../../src/modules/notifications/services/NotificationService";
import { createBookTitle, addBookCopy } from "../../../src/modules/library/services/LibraryCatalogService";
import { issueBook } from "../../../src/modules/library/services/LibraryCirculationService";
import { createPrintRequest, markPrinted } from "../../../src/modules/printing/services/PrintRequestService";
import { createBox } from "../../../src/modules/archive/services/ArchiveService";
import { StaffProfile } from "../../../src/modules/foundation/models/StaffProfile";
import { Student } from "../../../src/modules/foundation/models/Student";
import { resyncAllChatGroups } from "../../../src/modules/chat/services/ChatGroupService";
import { noteCheckShown, recordAiExchange } from "../../../src/modules/platform/services/AiExchangeService";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
  console.error("Refusing: MONGODB_URI must be a local in-memory database (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

/** YYYY-MM-DD in Dhaka, `days` from today. */
function dayKey(days: number): string {
  const d = new Date(Date.now() + days * 86400000 + 6 * 3600000);
  return d.toISOString().slice(0, 10);
}

export async function seedOps() {
  const base = await seedBaseSchool();
  const { users, classes, sections, students, guardianId } = base;
  const id = (x: unknown) => String(x);

  // ── Notifications ─────────────────────────────────────────────────────────
  const teacherNotes = [
    { kind: "COVER_ASSIGNED", titleBn: "বদলি ক্লাস দেওয়া হয়েছে", bodyBn: "আগামীকাল ৩য় শ্রেণি (বালিকা), ৩য় পিরিয়ড — ইংরেজি ক্লাসটি আপনি নেবেন।" },
    { kind: "LIBRARY_DUE_SOON", titleBn: "লাইব্রেরির বই ফেরতের সময় হয়েছে", bodyBn: "“ঠাকুরমার ঝুলি” বইটি পরশু ফেরত দিতে হবে।" },
    { kind: "REVIEW_ASSIGNED", titleBn: "পাঠ পরিকল্পনা পর্যালোচনার দায়িত্ব", bodyBn: "৩য় শ্রেণির গণিত, অধ্যায় ৪ — পরিকল্পনাটি দেখে মতামত দিন।" },
  ];
  for (const [i, n] of teacherNotes.entries()) {
    await emit({ recipientUserId: id(users.teacher), ...n, dedupeKey: `help-ops:teacher:${i}` });
  }
  const guardianNotes = [
    { kind: "CLASS_TEST_RESULT", titleBn: "ক্লাস টেস্টের ফল প্রকাশিত", bodyBn: "আরিফ হোসেন — গণিত ক্লাস টেস্টে ২০-এ ১৭ পেয়েছে।" },
    { kind: "HW_CHASE", titleBn: "বাড়ির কাজ জমা বাকি", bodyBn: "নাফিসা রহমানের ইংরেজি বাড়ির কাজ এখনো জমা হয়নি।" },
  ];
  for (const [i, n] of guardianNotes.entries()) {
    await emit({ recipientGuardianId: id(guardianId), ...n, dedupeKey: `help-ops:guardian:${i}` });
  }

  // ── Library ───────────────────────────────────────────────────────────────
  const office = id(users.office);
  const books = [
    { titleBn: "ঠাকুরমার ঝুলি", author: "দক্ষিণারঞ্জন মিত্র মজুমদার", language: "BANGLA" as const, category: "গল্প", shelf: "তাক ১", copies: ["LIB-001", "LIB-002"] },
    { titleBn: "আম আঁটির ভেঁপু", author: "বিভূতিভূষণ বন্দ্যোপাধ্যায়", language: "BANGLA" as const, category: "উপন্যাস", shelf: "তাক ২", copies: ["LIB-003"] },
    { titleBn: "ছোট্ট রাজপুত্র", titleEn: "The Little Prince", author: "Antoine de Saint-Exupéry", language: "ENGLISH" as const, category: "গল্প", shelf: "তাক ৩", copies: ["LIB-004"] },
  ];
  for (const b of books) {
    const t = await createBookTitle(
      { titleBn: b.titleBn, titleEn: b.titleEn ?? null, author: b.author, language: b.language, category: b.category, shelf: b.shelf },
      office,
    );
    for (const acc of b.copies) await addBookCopy(id(t._id), acc, null, office);
  }
  await issueBook("LIB-003", { type: "STUDENT", id: id(students.c3Boys[1]) }, office);

  // ── Print requests ────────────────────────────────────────────────────────
  const link = "https://example.org/help/worksheet.pdf";
  const jobs = [
    { title: "গণিত অনুশীলনী — ভগ্নাংশ", purpose: "CLASSWORK", by: users.teacher, classId: classes.c3, sectionId: sections.c3Boys, subject: "MATH", copies: 6 },
    { title: "ইংরেজি বাড়ির কাজ — Unit 5", purpose: "HOMEWORK", by: users.teacher2, classId: classes.c3, sectionId: sections.c3Girls, subject: "ENG", copies: 6 },
    { title: "ইংরেজি রচনার খাতা", purpose: "CLASSWORK", by: users.teacher2, classId: classes.c5, sectionId: sections.c5, subject: "ENG", copies: 6 },
    { title: "অভিভাবক সভার নোটিশ", purpose: "OTHER", by: users.teacher, classId: null, sectionId: null, subject: null, copies: 20 },
  ];
  const made = [];
  for (const j of jobs) {
    made.push(
      await createPrintRequest({
        title: j.title,
        purpose: j.purpose,
        sourceType: "LINK",
        linkUrl: link,
        colour: "BW",
        sides: "SINGLE",
        copies: j.copies,
        neededByKey: dayKey(1),
        classId: j.classId ? id(j.classId) : null,
        sectionId: j.sectionId ? id(j.sectionId) : null,
        subject: j.subject,
        requestedBy: id(j.by),
      }),
    );
  }
  await markPrinted(id(made[2]._id), office);

  // ── Script archive ────────────────────────────────────────────────────────
  await createBox({ label: "৫ম শ্রেণি · ২০২৬", locationNote: "অফিস আলমারি, তাক ২", actorId: office });

  // ── Family phones on the student rows (the guardian WhatsApp notice builds its links from them) ──
  let p = 10;
  for (const sid of [...students.c3Boys, ...students.c3Girls, ...students.c5]) {
    p += 1;
    await Student.updateOne({ _id: sid }, { $set: { phone: `018100000${p}` } });
  }

  // ── Chat: the school, section and subject groups every staff login starts with ──
  await resyncAllChatGroups(id(users.principal));

  // ── A staff record with no login yet ──────────────────────────────────────
  await StaffProfile.create({
    schoolId: "S-09",
    name: "উদাহরণ নতুন শিক্ষক",
    phone: "01700000009",
    category: "teacher",
    employmentType: "full_time",
    employmentStatus: "probation",
    gender: "female",
    active: true,
  });

  // ── The AI request & reply log (D-#1179): two invented, de-identified exchanges ──
  const prefix = "You check comments that teachers of a Bangladeshi school write about a child …\n\nTHE STANDARD:\n## দৈনিক মন্তব্যের মানদণ্ড (উদাহরণ)";
  const attempt = { provider: "deepseek", modelName: "deepseek-v4-flash", outcome: "ok" as const, fallback: false, latencyMs: 2100, costUsd: 0.0004 };
  const teacherId = (base as { users?: { teacher?: string } }).users?.teacher ?? null;
  await recordAiExchange({
    at: new Date(),
    feature: "comment_check",
    callId: "help-fixture-check-1",
    userId: teacherId,
    role: "TEACHER",
    refType: "StudentComment",
    policyHash: "comment_standard@v1#a1b2c3d4e5f6",
    stablePrefix: prefix,
    request: JSON.stringify({ kind: "daily comment to the guardian", fields: { text: "[S] আজ বাড়ির কাজ আনেননি" }, sentiment: { code: "CONCERN", bn: "উদ্বেগ" } }),
    reply: JSON.stringify({ issues: [{ field: "text", type: "structure", quote: "[S] আজ বাড়ির কাজ আনেননি", suggestion: "আসসালামু আলাইকুম। উনি আজ বাড়ির কাজ আনেননি।" }], corrected: { text: "আসসালামু আলাইকুম। উনি আজ বাড়ির কাজ আনেননি।" } }),
    attempts: [attempt],
  });
  await noteCheckShown("help-fixture-check-1", 1, { structure: 1 });
  await recordAiExchange({
    at: new Date(Date.now() - 3600_000),
    feature: "assistant",
    callId: "help-fixture-assistant-1",
    userId: teacherId,
    role: "TEACHER",
    refType: "AiAssistSession",
    refId: "help-fixture-session",
    policyHash: "assistant_rules@v1#f6e5d4c3b2a1",
    stablePrefix: "You are the teaching assistant of a Bangladeshi Islamic school …",
    context: "CHAPTER 3 (class 3, MATH)\n\n## Session 1: ভাগ",
    request: "ভাগের প্রথম পাঠ কীভাবে শুরু করব?",
    reply: "পাঠ পরিকল্পনা অনুযায়ী শুরুতে ১২টি পেনসিল ৩ জনে ভাগ করে দেখান …",
    attempts: [{ ...attempt, latencyMs: 5400, costUsd: 0.0012 }],
  });

  return base;
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    // --reset: start a re-shoot from an empty database (still local-only, guarded above).
    if (process.argv.includes("--reset")) await mongoose.connection.dropDatabase();
    const ids = await seedOps();
    console.log("fixture: ops (base school + notifications, library, print queue, archive box, one staff record without a login)");
    console.log(JSON.stringify(ids));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
