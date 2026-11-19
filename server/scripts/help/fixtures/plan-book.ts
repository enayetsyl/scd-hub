/**
 * Example data for the "পরিকল্পনার পাশে বই পড়া" help guide (specs/plan-book.cjs): the school's own
 * ৩য় শ্রেণি বিজ্ঞান book beside a lesson plan (D-#1653).
 *
 * Create-only, LOCAL ONLY: it refuses any database that is not an in-memory one
 * (mongodb://127.0.0.1:<port>/) and needs BOOK_MONGODB_URI on the same kind of server (another db).
 * Google Drive is replaced by a folder on disk (HELP_FAKE_DRIVE, default $TMP/help-fake-drive); run
 * the API with fake-drive-server.ts and the SAME folder so the book files can be read back.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hc BOOK_MONGODB_URI=mongodb://127.0.0.1:<port>/hcbooks \
 *     npx tsx scripts/help/fixtures/plan-book.ts [--reset]
 *
 * Adds, through the app's own services (the book plane import + release and the plan import gate):
 *   - the C3-SCI book: a FINAL, print-released version v1.0 whose master has the front matter and two
 *     chapters in the real "after-heading" shape (heading, picture, পর্যালোচনা-নোট, শিক্ষক-নোট, the
 *     children's text with a picture), one small JPEG (plan-book-picture.jpg), and a STUDENT edition
 *     .docx holding the children's text;
 *   - two ৩য় শ্রেণি বিজ্ঞান session plans for অধ্যায় ১. teacher@help.test teaches বিজ্ঞান in ৩য় বালক
 *     (so opens them); session 1 is assigned to teacher2@help.test for review (the ReviewSubmit screen).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import type { AuthPayload } from "../../../src/context";
import { seedBaseSchool } from "../fixture";
import { connectBookDb, bookConnection } from "../../../src/bookDb";
import { importEnvelope } from "../../../src/modules/content/services/ContentService";
import { assignPlanReview } from "../../../src/modules/content/services/ReviewService";
import { ContentArtifact } from "../../../src/modules/content/models/ContentArtifact";
import { ScopeGrant } from "../../../src/modules/foundation/models/ScopeGrant";
import { importBook, markFinal, uploadVersionFile } from "../../../src/modules/book-lifecycle/services/versionService";
import { createRelease, addReleaseFile, recordRelease } from "../../../src/modules/book-lifecycle/services/releaseService";

const uri = process.env.MONGODB_URI ?? "";
const bookUri = process.env.BOOK_MONGODB_URI ?? "";
const LOCAL = /^mongodb:\/\/127\.0\.0\.1:\d+\//;
if (!LOCAL.test(uri) || !LOCAL.test(bookUri)) {
  console.error("Refusing: MONGODB_URI and BOOK_MONGODB_URI must be local in-memory databases (mongodb://127.0.0.1:<port>/…).");
  process.exit(2);
}

// ── Google Drive → a folder on disk (same layout as fake-drive-server.ts) ───────────────────────
const DRIVE_DIR = process.env.HELP_FAKE_DRIVE || path.join(os.tmpdir(), "help-fake-drive");
fs.mkdirSync(DRIVE_DIR, { recursive: true });
process.env.GOOGLE_OAUTH_CLIENT_ID = "dummy";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "dummy";
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "dummy";
let seq = 0;
const jsonRes = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://oauth2.googleapis.com/")) return jsonRes({ access_token: "fake", expires_in: 3600 });
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
    const ct = String((init?.headers as Record<string, string>)?.["Content-Type"] ?? "");
    const boundary = ct.split("boundary=")[1];
    const body = Buffer.from(init?.body as Buffer);
    const start = body.indexOf("\r\n\r\n", body.indexOf(`--${boundary}\r\nContent-Type`, 10)) + 4;
    const end = body.lastIndexOf(`\r\n--${boundary}--`);
    seq += 1;
    const id = `fixture-${Date.now()}-${seq}`;
    fs.writeFileSync(path.join(DRIVE_DIR, id), body.subarray(start, end));
    return jsonRes({ id });
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
    const m = url.match(/files\/([^?/]+)/);
    if (m && init?.method === "DELETE") {
      fs.rmSync(path.join(DRIVE_DIR, decodeURIComponent(m[1])), { force: true });
      return new Response(null, { status: 204 });
    }
    if (m && url.includes("alt=media")) return new Response(fs.readFileSync(path.join(DRIVE_DIR, decodeURIComponent(m[1]))), { status: 200 });
    if (init?.method === "POST") return jsonRes({ id: "fake-folder" });
    return jsonRes({ files: [{ id: "fake-folder" }] });
  }
  if (url.includes("googleapis.com")) throw new Error(`plan-book fixture refused a Google call: ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

// ── The book text (invented) ────────────────────────────────────────────────────────────────────
const J = (...p: string[]) => p.join("\n\n") + "\n\n";
const TITLE1 = "অধ্যায় ১: উদ্ভিদ পরিচিতি";
const TITLE2 = "অধ্যায় ২: পানি ও বায়ু";
const CHILD1 = [
  "আমাদের চারপাশে নানা রকম গাছ আছে। কিছু গাছ ছোট, কিছু গাছ অনেক বড়।",
  "গাছের শিকড় মাটির নিচে থাকে। শিকড় মাটি থেকে পানি টেনে নেয়।",
  "গাছের পাতা সূর্যের আলো থেকে খাবার তৈরি করে। তাই গাছের সবুজ পাতা খুব দরকারি।",
];
const CHILD2 = [
  "পানি আমরা পান করি এবং গোসল করি। বাতাস আমাদের চারপাশে থাকে।",
  "বাতাস চোখে দেখা যায় না, কিন্তু গাছের পাতা নড়লে আমরা বুঝতে পারি।",
];
const MASTER = [
  "# আমার বিজ্ঞান — ৩য় শ্রেণি",
  "",
  "ভূমিকা: এই বইয়ে আমরা চারপাশের জিনিস দেখে দেখে বিজ্ঞান শিখব।",
  "",
  J(
    `## ${TITLE1}`,
    "![উদ্ভিদ পরিচিতি](media/sun-house.jpg)",
    "**পর্যালোচনা-নোট — অধ্যায় ১ — উদ্ভিদ পরিচিতি**",
    "ছবির নিচে শিরোনাম বসানো আছে কি না দেখুন।",
    "শিখনফলের ভাষা সহজ রাখা হয়েছে; অনুগ্রহ করে একবার পড়ে নিন।",
    "**শিক্ষক-নোট — অধ্যায় ১ — উদ্ভিদ পরিচিতি**",
    "শিখনফল: শিক্ষার্থী গাছের শিকড় ও পাতার কাজ নিজের ভাষায় বলতে পারবে।",
    "উত্তর: শিকড় মাটি থেকে পানি টেনে নেয়; পাতা সূর্যের আলো থেকে খাবার তৈরি করে।",
    "ক্লাসে একটি ছোট গাছ বা পাতা দেখিয়ে শিক্ষার্থীদের প্রশ্ন করুন: গাছ কীভাবে খাবার পায়?",
    ...CHILD1,
    "![আলো ও ঘর](media/sun-house.jpg)",
  ),
  J(
    `## ${TITLE2}`,
    "**পর্যালোচনা-নোট — অধ্যায় ২ — পানি ও বায়ু**",
    "অনুচ্ছেদের দৈর্ঘ্য ঠিক আছে।",
    "**শিক্ষক-নোট — অধ্যায় ২ — পানি ও বায়ু**",
    "শিখনফল: শিক্ষার্থী পানি ও বায়ুর একটি করে ব্যবহার বলতে পারবে।",
    "উত্তর: আমরা পানি পান করি; আমরা বাতাসে শ্বাস নিই।",
    ...CHILD2,
  ),
].join("\n");

const JPEG = fs.readFileSync(path.join(__dirname, "plan-book-picture.jpg"));

const wp = (style: string | null, text: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
async function studentDocx(): Promise<Buffer> {
  const lines: [string | null, string][] = [
    ["Heading2", TITLE1],
    ...CHILD1.map((t): [string | null, string] => [null, t]),
    ["Heading2", TITLE2],
    ...CHILD2.map((t): [string | null, string] => [null, t]),
  ];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map(([s, t]) => wp(s, t)).join("")}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function pdf(text: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A5", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  doc.on("data", (c: Buffer) => chunks.push(c));
  doc.font("Helvetica").fontSize(14).text(text);
  doc.end();
  return done;
}

const stepsMd = (n: number) =>
  `# পিরিয়ড ${n}: উদ্ভিদ পরিচিতি — তৃতীয় শ্রেণি বিজ্ঞান (${n}/2)\n\n` +
  "## এক নজরে ও শিক্ষকের প্রস্তুতি (শুরুতেই পড়ুন)\n\nএই পিরিয়ডে শিক্ষার্থীরা গাছের শিকড় ও পাতার কাজ চিনবে। শিক্ষক একটি ছোট গাছ বা পাতা ক্লাসে আনবেন।\n\n" +
  "**শিক্ষকের প্রস্তুতি:**\n\n- [ ] **1.** একটি পাতা ও একটু মাটি ক্লাসে আনুন।\n\n- [ ] **2.** বোর্ডে শিকড়, কাণ্ড ও পাতা লেখার জায়গা রাখুন।\n\n- [ ] **3.** বইয়ের অধ্যায় ১ একবার পড়ে নিন।\n\n" +
  "## এই পিরিয়ডে / This Session\n\n**আজকের লক্ষ্য।** গাছের শিকড় ও পাতার কাজ নিজের ভাষায় বলা।\n\n**আজকের Exit-Check।** শিকড় কী কাজ করে? একজন শিক্ষার্থীকে বলতে বলুন।\n\n" +
  "## পাঠ-প্রবাহ\n\n" +
  Array.from({ length: 8 }, (_, i) => `**ধাপ ${i + 1}।** শিক্ষার্থীদের সঙ্গে গাছের একটি অংশ নিয়ে কথা বলুন, ছোট প্রশ্ন করুন এবং উত্তর বোর্ডে লিখুন। (${i + 3} মিনিট)`).join("\n\n") +
  "\n\n**আজকের বাড়ির কাজ।** বাড়ির আশপাশের একটি গাছের পাতা দেখে এসে দুটি বাক্যে লিখুন।\n";

export async function seedPlanBook() {
  const base = await seedBaseSchool();
  const { users } = base;
  const principal: AuthPayload = { userId: String(users.principal), role: "PRINCIPAL", grantedPermissions: [], revokedPermissions: [], additionalTemplates: [] };

  // ── The book: final + print-released ──────────────────────────────────────
  await connectBookDb(bookUri);
  const media = new JSZip();
  media.file("media/sun-house.jpg", JPEG);
  const { version } = await importBook(principal, {
    code: "C3-SCI",
    classLevel: 3,
    subject: "SCI",
    titleBn: "আমার বিজ্ঞান",
    version: "v1.0",
    state: "approved",
    masterMd: Buffer.from(MASTER),
    mediaZip: await media.generateAsync({ type: "nodebuffer" }),
  });
  const vid = version._id.toString();
  await uploadVersionFile(principal, vid, { role: "edition", edition: "TEACHER", name: "TEACHER.pdf", data: await pdf("Teacher edition (example)"), mime: "application/pdf" });
  await uploadVersionFile(principal, vid, { role: "edition", edition: "STUDENT", name: "STUDENT.docx", data: await studentDocx() });
  await markFinal(principal, vid);
  const rel = await createRelease(principal, vid, { labelBn: "প্রথম ছাপা (উদাহরণ)" });
  await addReleaseFile(principal, rel._id.toString(), { edition: "STUDENT", kind: "idml_zip", name: "s.zip", data: Buffer.from("PK\x03\x04example"), mime: "application/zip" });
  await addReleaseFile(principal, rel._id.toString(), { edition: "STUDENT", kind: "preview_pdf", name: "s.pdf", data: await pdf("Print preview (example)"), mime: "application/pdf" });
  await recordRelease(principal, rel._id.toString());

  // ── Plans: ৩য় শ্রেণি বিজ্ঞান অধ্যায় ১, sessions 1–2 ─────────────────────────
  await ScopeGrant.create({
    teacherId: users.teacher,
    kind: "teaching",
    active: true,
    source: "manual",
    createdBy: users.principal,
    classId: base.classes.c3,
    sectionId: base.sections.c3Boys,
    subjectId: base.subjects.SCI,
  });
  const REPO = path.resolve(__dirname, "../../../..");
  const example = JSON.parse(fs.readFileSync(path.join(REPO, "docs/examples/envelope_C5_ENG_U09_S01.json"), "utf8"));
  const planIds: string[] = [];
  for (const n of [1, 2]) {
    const env = JSON.parse(JSON.stringify(example));
    env.review_status = "draft";
    env.subject = "SCI";
    env.class_level = 3;
    env.address = { anchor_word: "অধ্যায়", number: 1, title: "উদ্ভিদ পরিচিতি" };
    env.payload.subject = "SCI";
    env.payload.class_level = 3;
    env.payload.division = { ...env.address };
    env.tags.lesson_ref = `C3-SCI-U01-S0${n}`;
    env.provenance.source_filename = `example_C3_SCI_U01_S0${n}_session.json`;
    env.payload.session_plan.period_index = n;
    env.rendered_markdown = stepsMd(n);
    const r = await importEnvelope(env, String(users.principal));
    if (r.verdict !== "PASS") throw new Error(`plan S0${n}: import FAILED\n  ${(r.failChecks ?? []).join("\n  ")}`);
    const art = await ContentArtifact.findOne({ docType: "session_plan", subject: "SCI", current: true, "envelopeJson.payload.session_plan.period_index": n })
      .select("_id")
      .lean();
    planIds.push(String(art!._id));
  }
  await assignPlanReview({ artifactId: planIds[0], reviewerId: String(users.teacher2), assignedBy: String(users.office), actorRole: "OFFICE" });
  return { base, planIds, versionId: vid };
}

if (require.main === module) {
  (async () => {
    await mongoose.connect(uri);
    if (process.argv.includes("--reset")) {
      await mongoose.connection.dropDatabase();
      await connectBookDb(bookUri);
      await bookConnection.dropDatabase();
    }
    const r = await seedPlanBook();
    console.log("plan-book fixture: C3-SCI book v1.0 (final, print-released) + 2 SCI plans (session 1 assigned to teacher2 for review)");
    console.log(JSON.stringify({ planIds: r.planIds, versionId: r.versionId }));
    await mongoose.disconnect();
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
