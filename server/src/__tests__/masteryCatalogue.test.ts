/**
 * Mastery tracker M-0 — catalogue, mark table, tags, policy, switch
 * (docs/prd-mastery.md §5.1, D-#775–#787).
 *
 * Import  — the dry run equals the apply; DRAFT rows that vanish are deleted, LOCKED rows
 *           that vanish are RETIRED; a LOCKED outcome cannot change its assessment mode; a
 *           retired code cannot come back; a marks change appends history (D-#777).
 * Lock    — DRAFT → LOCKED; codes permanent; retire keeps the row.
 * Tags    — seed tags appear on first read; a routing tag is refused until its strand
 *           exists in every scope, refused "everywhere", and needs item types at ITEM level (D-#787).
 * Policy  — validated on the RESOLVED values; an override inherits the school row; a school
 *           change that would break an override is refused.
 * Switch  — refused before the pair's catalogue is locked; on after (D-#775).
 * RBAC    — mastery:read reads, mastery:manage writes: TEACHER/OFFICE cannot write the catalogue.
 *
 * In-memory MongoDB, real services.
 */
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { graphql, type ExecutionResult } from "graphql";
import { callerHasPermission } from "@scd/shared";
import { AcademicYear } from "../modules/foundation/models/AcademicYear";
import { MasteryOutcome } from "../modules/mastery/models/MasteryOutcome";
import { MasteryQuestionType } from "../modules/mastery/models/MasteryQuestionType";
import {
  getCatalogue,
  getPolicy,
  importCatalogue,
  isMasteryEnabled,
  listTags,
  lockCatalogue,
  retireOutcome,
  saveOutcome,
  savePolicy,
  saveQuestionType,
  saveTag,
  setEnablement,
} from "../modules/mastery/services/MasteryCatalogueService";
import { diffCatalogue, parseCatalogueImport, resolvePolicy, validatePolicy } from "../modules/mastery/catalogue";
import { builder } from "../schema";
import "../modules/mastery/resolvers/masteryCatalogue";

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const actor = { userId: new Types.ObjectId().toString(), role: "PRINCIPAL" };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
});

function catalogue(over: Record<string, unknown> = {}) {
  return {
    classToken: "C3",
    subject: "MATH",
    status: "DRAFT",
    bookRef: "Class 3 Math/C3_MATH_Book_v2.1_Writer-Reviewer.docx",
    chapters: [
      { number: 7, titleBn: "ভাগ" },
      { number: 10, titleBn: "ভগ্নাংশ" },
    ],
    outcomes: [
      { code: "LO-C3-MATH-07-02", labelBn: "নামতা দিয়ে ভাগফল ও ভাগশেষ", sourceText: "নামতা দিয়ে ভাগফল ও ভাগশেষ বের করতে পারবে", assess: "QUESTION", questionTypeCodes: ["QT-SHORT", "QT-SOLVE"], homeTipBn: "নামতা মুখে বলান।" },
      { code: "LO-C3-MATH-07-03", labelBn: "খাতায় লম্বা ভাগ", sourceText: "খাতায় লম্বা ভাগ করতে পারবে", assess: "QUESTION", questionTypeCodes: ["QT-SOLVE", "QT-WORD"] },
      { code: "LO-C3-MATH-10-01", labelBn: "ভগ্নাংশ পড়া ও লেখা", sourceText: "ভগ্নাংশ পড়তে, লিখতে ও রং করতে পারবে", assess: "QUESTION", questionTypeCodes: ["QT-SHORT"] },
      { code: "LO-C3-MATH-SK-ANS-01", labelBn: "কথার অঙ্কে উত্তর-বাক্য লেখা", sourceText: "ট্যাগ উত্তর-বাক্য নেই", assess: "QUESTION", questionTypeCodes: [] },
      { code: "LO-C3-MATH-SK-MENT-01", labelBn: "মুখে হিসাব", sourceText: "মৌখিক", assess: "RUBRIC", questionTypeCodes: [] },
    ],
    questionTypes: [
      { code: "QT-SHORT", labelBn: "সংক্ষিপ্ত প্রশ্ন", marks: 1 },
      { code: "QT-SOLVE", labelBn: "সমাধান করো", marks: 2 },
      { code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 5 },
      { code: "QT-CREATIVE", labelBn: "সমস্যা সমাধান (সৃজনশীল)", marks: 10 },
    ],
    ...over,
  };
}

describe("parse + diff (pure)", () => {
  it("rejects a malformed code, a class/subject mismatch and an undefined question type", () => {
    const bad = catalogue({
      outcomes: [
        { code: "LO-C3-MATH-7-3", labelBn: "x", assess: "QUESTION", questionTypeCodes: [] },
        { code: "LO-C2-MATH-07-01", labelBn: "x", assess: "QUESTION", questionTypeCodes: [] },
        { code: "LO-C3-MATH-07-04", labelBn: "x", assess: "QUESTION", questionTypeCodes: ["QT-NOPE"] },
        { code: "LO-C3-MATH-09-01", labelBn: "x", assess: "QUESTION", questionTypeCodes: [] },
      ],
    });
    const r = parseCatalogueImport(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toMatch(/LO-C3-MATH-7-3/);
    expect(r.errors.join("\n")).toMatch(/LO-C2-MATH-07-01/);
    expect(r.errors.join("\n")).toMatch(/QT-NOPE/);
    expect(r.errors.join("\n")).toMatch(/অধ্যায় 9/);
  });

  it("reads strands as chapterless outcomes and RUBRIC from the Bangla word too", () => {
    const r = parseCatalogueImport(catalogue());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ans = r.catalogue.outcomes.find((o) => o.code === "LO-C3-MATH-SK-ANS-01")!;
    expect(ans.chapterNumber).toBeNull();
    expect(ans.strand).toBe("ANS");
    const r2 = parseCatalogueImport(catalogue({ outcomes: [{ code: "LO-C3-MATH-07-02", labelBn: "x", assess: "রুব্রিক", questionTypeCodes: [] }] }));
    expect(r2.ok && r2.catalogue.outcomes[0].assess).toBe("RUBRIC");
  });

  it("a LOCKED outcome may not change its assessment mode; a RETIRED code may not return", () => {
    const parsed = parseCatalogueImport(catalogue());
    if (!parsed.ok) throw new Error("fixture");
    const base = { labelBn: "x", sourceText: "", questionTypeCodes: [] as string[], order: 1 };
    const d = diffCatalogue(
      { ...parsed.catalogue, outcomes: parsed.catalogue.outcomes.map((o) => (o.code === "LO-C3-MATH-07-02" ? { ...o, assess: "RUBRIC" as const } : o)) },
      [
        { code: "LO-C3-MATH-07-02", status: "LOCKED", assess: "QUESTION", ...base },
        { code: "LO-C3-MATH-07-03", status: "RETIRED", assess: "QUESTION", ...base },
      ],
      [],
    );
    expect(d.errors.some((e) => e.includes("LO-C3-MATH-07-02"))).toBe(true);
    expect(d.errors.some((e) => e.includes("LO-C3-MATH-07-03"))).toBe(true);
  });
});

describe("import / lock / retire (DB)", () => {
  it("the dry run writes nothing and reports exactly what the apply then does", async () => {
    const json = JSON.stringify(catalogue());
    const dry = await importCatalogue(json, false, actor);
    expect(dry.ok).toBe(true);
    expect(dry.applied).toBe(false);
    expect(dry.diff!.added).toHaveLength(5);
    expect(await MasteryOutcome.countDocuments({})).toBe(0);

    const applied = await importCatalogue(json, true, actor);
    expect(applied.applied).toBe(true);
    expect(applied.diff!.added).toEqual(dry.diff!.added);
    const cat = await getCatalogue("C3", "MATH");
    expect(cat.draftCount).toBe(5);
    expect(cat.chapters.find((c) => c.number === 7)!.outcomeCount).toBe(2);
    expect(cat.questionTypes.find((q) => q.code === "QT-WORD")!.marks).toBe(5);
  });

  it("re-import: a vanished DRAFT is deleted; after LOCK a vanished code is RETIRED, never deleted", async () => {
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    const minus = (c: Record<string, unknown>, code: string): Record<string, unknown> => ({
      ...c,
      outcomes: (c.outcomes as { code: string }[]).filter((o) => o.code !== code),
    });
    const r1 = await importCatalogue(JSON.stringify(minus(catalogue(), "LO-C3-MATH-10-01")), true, actor);
    expect(r1.diff!.removedDrafts).toEqual(["LO-C3-MATH-10-01"]);
    expect(await MasteryOutcome.exists({ code: "LO-C3-MATH-10-01" })).toBeNull();

    expect(await lockCatalogue("C3", "MATH", actor)).toBe(4);
    const r2 = await importCatalogue(JSON.stringify(minus(minus(catalogue(), "LO-C3-MATH-10-01"), "LO-C3-MATH-07-02")), true, actor);
    expect(r2.diff!.retired).toEqual(["LO-C3-MATH-07-02"]);
    const row = await MasteryOutcome.findOne({ code: "LO-C3-MATH-07-02" }).lean();
    expect(row!.status).toBe("RETIRED");

    // …and it cannot come back.
    const r3 = await importCatalogue(JSON.stringify(catalogue()), true, actor);
    expect(r3.ok).toBe(false);
    expect(r3.applied).toBe(false);
    expect(r3.errors.join(" ")).toMatch(/LO-C3-MATH-07-02/);
  });

  it("a file marked LOCKED imports as LOCKED; retiring keeps the row; a DRAFT retire removes it", async () => {
    await importCatalogue(JSON.stringify(catalogue({ status: "LOCKED (2026-11-01, owner)" })), true, actor);
    expect((await getCatalogue("C3", "MATH")).lockedCount).toBe(5);
    expect(await retireOutcome("LO-C3-MATH-10-01", actor)).toBe("RETIRED");
    expect((await getCatalogue("C3", "MATH", true)).retiredCount).toBe(1);
    await expect(retireOutcome("LO-C3-MATH-10-01", actor)).rejects.toThrow(/আগেই/);

    await importCatalogue(JSON.stringify({ ...catalogue(), classToken: "C2", outcomes: [{ code: "LO-C2-MATH-07-01", labelBn: "x", assess: "QUESTION", questionTypeCodes: [] }] }), true, actor);
    expect(await retireOutcome("LO-C2-MATH-07-01", actor)).toBe("DELETED");
  });

  it("question-type marks: an import or an edit that changes marks appends history; old values stay readable (D-#777)", async () => {
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    const changed = catalogue({
      questionTypes: (catalogue().questionTypes as { code: string; marks: number }[]).map((q) => (q.code === "QT-WORD" ? { ...q, marks: 4 } : q)),
    });
    const r = await importCatalogue(JSON.stringify(changed), true, actor);
    expect(r.diff!.qtMarksChanged).toEqual([{ code: "QT-WORD", from: 5, to: 4 }]);
    const v = await saveQuestionType({ classToken: "C3", subject: "MATH", code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 4.5 }, actor);
    expect(v.marks).toBe(4.5);
    expect(v.history.map((h) => h.marks)).toEqual([5, 4, 4.5]);
    await expect(
      saveQuestionType({ classToken: "C3", subject: "MATH", code: "QT-WORD", labelBn: "কথার অঙ্ক", marks: 1.3 }, actor),
    ).rejects.toThrow(/০.৫/);
  });

  it("an outcome edit may name only defined question types", async () => {
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    const v = await saveOutcome("LO-C3-MATH-07-03", { labelBn: "লম্বা ভাগ", homeTipBn: "প্রতিদিন ২টি ভাগ।" }, actor);
    expect(v.labelBn).toBe("লম্বা ভাগ");
    await expect(saveOutcome("LO-C3-MATH-07-03", { questionTypeCodes: ["QT-NOPE"] }, actor)).rejects.toThrow(/QT-NOPE/);
  });
});

describe("tags (D-#778/#787)", () => {
  const routing = {
    code: "NO_ANSWER_SENTENCE",
    labelBn: "উত্তর-বাক্য নেই",
    appliesTo: "ITEM" as const,
    effect: "ROUTE_STRAND" as const,
    routeStrand: "ANS",
    routeSeq: 1,
    level: "ITEM" as const,
    questionTypeCodes: ["QT-WORD", "QT-CREATIVE"],
    deductionMarks: 0.5,
    allScopes: false,
    scopes: [{ classToken: "C3" as const, subject: "MATH" as const }],
    active: true,
  };

  it("seeds the default tags on first read, routing tags switched off", async () => {
    const tags = await listTags();
    expect(tags.map((t) => t.code)).toEqual(expect.arrayContaining(["CONCEPT_GAP", "NO_ANSWER_SENTENCE", "HANDWRITING_UNCLEAR", "COPIED"]));
    expect(tags.find((t) => t.code === "NO_ANSWER_SENTENCE")!.active).toBe(false);
  });

  it("a routing tag is refused until the strand exists in its scope, then accepted", async () => {
    await expect(saveTag(routing, actor)).rejects.toThrow(/LO-C3-MATH-SK-ANS-01/);
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    const t = await saveTag(routing, actor);
    expect(t.active).toBe(true);
    expect(t.scopes).toEqual([{ classToken: "C3", subject: "MATH" }]);
    // C2 Math has no SK-ANS (its book forbids answer sentences) — adding that scope is refused.
    await expect(saveTag({ ...routing, scopes: [...routing.scopes, { classToken: "C2", subject: "MATH" }] }, actor)).rejects.toThrow(/C2 MATH/);
  });

  it("a routing tag cannot be 'everywhere' and needs item types at ITEM level that exist in the scope", async () => {
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    await expect(saveTag({ ...routing, allScopes: true, scopes: [] }, actor)).rejects.toThrow(/সব জায়গায়/);
    await expect(saveTag({ ...routing, questionTypeCodes: [] }, actor)).rejects.toThrow(/ধরনের প্রশ্নে/);
    await expect(saveTag({ ...routing, questionTypeCodes: ["QT-ESSAY"] }, actor)).rejects.toThrow(/QT-ESSAY/);
  });

  it("an admin-added plain tag saves without scopes when it is everywhere", async () => {
    const t = await saveTag({ code: "MESSY_BOOK", labelBn: "অগোছালো খাতা", appliesTo: "WORK", effect: "LIGHT", allScopes: true, scopes: [], active: true }, actor);
    expect(t.system).toBe(false);
    await expect(saveTag({ ...t, code: "bad code", appliesTo: "WORK", effect: "LIGHT", scopes: [] } as never, actor)).rejects.toThrow(/কোড/);
  });
});

describe("policy", () => {
  it("defaults resolve and validate; the mix must sum to 100", () => {
    expect(validatePolicy(resolvePolicy(null, null))).toBeNull();
    expect(validatePolicy(resolvePolicy({ assignmentMixWeak: 70 }, null))).toMatch(/১০০/);
    expect(validatePolicy(resolvePolicy({ weakBelowPct: 80 }, null))).toMatch(/দুর্বল/);
  });

  it("an override stores only its keys and inherits the rest from the school row", async () => {
    await savePolicy(null, null, { sectionTriggerPct: 60 }, actor);
    const ov = await savePolicy("C1", "BAN", { minQuestionsForVerdict: 3 }, actor);
    expect(ov.ownKeys).toEqual(["minQuestionsForVerdict"]);
    expect(ov.resolved.minQuestionsForVerdict).toBe(3);
    expect(ov.resolved.sectionTriggerPct).toBe(60);
    expect((await getPolicy()).resolved.minQuestionsForVerdict).toBe(2);
  });

  it("refuses an inconsistent override and a school change that would break an override", async () => {
    await expect(savePolicy("C3", "MATH", { assignmentMixWeak: 90 }, actor)).rejects.toThrow(/১০০/);
    await savePolicy("C3", "MATH", { improvingAtPct: 55 }, actor);
    await expect(savePolicy(null, null, { weakBelowPct: 60 }, actor)).rejects.toThrow(/C3:MATH/);
  });
});

describe("the switch (D-#775)", () => {
  it("refuses ON before the catalogue is locked, allows it after", async () => {
    const [year] = await AcademicYear.create([{ label: "2027", startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31") }]);
    const yearId = String(year._id);
    await importCatalogue(JSON.stringify(catalogue()), true, actor);
    await expect(setEnablement(yearId, "C3", "MATH", true, actor)).rejects.toThrow(/লক/);
    await lockCatalogue("C3", "MATH", actor);
    const on = await setEnablement(yearId, "C3", "MATH", true, actor);
    expect(on.enabled).toBe(true);
    expect(await isMasteryEnabled(yearId, "C3", "MATH")).toBe(true);
    expect(await isMasteryEnabled(yearId, "C3", "BAN")).toBe(false);
    await setEnablement(yearId, "C3", "MATH", false, actor);
    expect(await isMasteryEnabled(yearId, "C3", "MATH")).toBe(false);
    await expect(setEnablement(new Types.ObjectId().toString(), "C3", "MATH", false, actor)).rejects.toThrow(/শিক্ষাবর্ষ/);
  });
});

describe("RBAC over GraphQL", () => {
  const schema = builder.toSchema();
  type Auth = { role: string; userId: string; grantedPermissions?: string[] };
  const run = (source: string, auth: Auth | null): Promise<ExecutionResult> =>
    graphql({ schema, source, contextValue: { auth } }) as Promise<ExecutionResult>;
  const who = (role: string, grantedPermissions: string[] = []): Auth => ({ role, userId: new Types.ObjectId().toString(), grantedPermissions });
  const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;
  const IMPORT = `mutation { importMasteryCatalogue(catalogueJson: "{}", apply: false) { ok } }`;
  const READ = `query { masteryCatalogue(classToken: "C3", subject: "MATH") { draftCount } }`;

  it("TEACHER and OFFICE read the catalogue but cannot import; PRINCIPAL can; a guardian cannot read", async () => {
    expect(denied(await run(READ, who("TEACHER")))).toBe(false);
    expect(denied(await run(READ, who("OFFICE")))).toBe(false);
    expect(denied(await run(READ, who("GUARDIAN")))).toBe(true);
    expect(denied(await run(IMPORT, who("TEACHER")))).toBe(true);
    expect(denied(await run(IMPORT, who("OFFICE")))).toBe(true);
    const ok = await run(IMPORT, who("PRINCIPAL"));
    expect(ok.errors).toBeUndefined();
    expect((ok.data as { importMasteryCatalogue: { ok: boolean } }).importMasteryCatalogue.ok).toBe(false);
  });

  it("mastery:approve reaches an OFFICE holder only through a per-user grant (D-#786)", () => {
    expect(callerHasPermission({ role: "OFFICE" }, "mastery:approve")).toBe(false);
    expect(callerHasPermission({ role: "OFFICE", grantedPermissions: ["mastery:approve"] }, "mastery:approve")).toBe(true);
    expect(callerHasPermission({ role: "PRINCIPAL" }, "mastery:approve")).toBe(true);
    expect(callerHasPermission({ role: "TEACHER" }, "mastery:approve")).toBe(false);
  });
});

// Keep the question-type model referenced so its index builds before the first test.
void MasteryQuestionType;
