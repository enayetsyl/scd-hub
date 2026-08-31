/**
 * A syllabus row must be able to say WHICH CLASS it belongs to.
 *
 * Found on prod by a teacher opening অনুমোদন: three cards, all headed "ইংরেজি",
 * with nothing to tell them apart. She holds English in three classes, and the
 * card rendered the subject alone — so signing one off was a guess.
 *
 * Underneath sat a second, quieter bug. `Class` stores its Bangla name as
 * `nameBn`, but ExamSyllabusReadService read `cls.label` in three places:
 *
 *   const cls = await Class.findById(classId).select("label level").lean()
 *   ...
 *   classLabel: cls.label ?? ""
 *
 * `label` is not a field, a virtual or an alias on that schema, so `classLabel`
 * was the empty string on EVERY surface that carried it — which is why the
 * Principal's coverage matrix had a blank শ্রেণি column too. The `?? ""` turned
 * a missing field into a plausible-looking blank instead of a crash, and the
 * `as unknown as {...}` cast around each read stopped tsc from ever objecting.
 *
 * Static reads, because both halves are invisible to the compiler: a wrong
 * field name behind a double cast is well-typed, and so is a card that renders
 * one of the props it was given.
 */
import { readFileSync } from "fs";
import path from "path";

const SERVICE = readFileSync(
  path.resolve(__dirname, "../modules/exams/services/ExamSyllabusReadService.ts"),
  "utf8",
);
const CLASS_MODEL = readFileSync(
  path.resolve(__dirname, "../modules/foundation/models/Class.ts"),
  "utf8",
);
const SCREEN = readFileSync(
  path.resolve(__dirname, "../../../app/src/screens/syllabus/SyllabusApprovalsScreen.tsx"),
  "utf8",
);
const RESOLVER = readFileSync(
  path.resolve(__dirname, "../modules/exams/resolvers/examSyllabus.ts"),
  "utf8",
);
const APP_GQL = readFileSync(
  path.resolve(__dirname, "../../../app/src/graphql/examSyllabus.ts"),
  "utf8",
);

describe("the class name is read from the field that exists", () => {
  test("Class stores its name as nameBn, and has no `label`", () => {
    // The premise of every assertion below. If the model ever gains a real
    // `label`, this test should fail loudly rather than silently going stale.
    expect(CLASS_MODEL).toMatch(/nameBn: \{ type: String/);
    expect(CLASS_MODEL).not.toMatch(/\blabel\b/);
  });

  test("the read service never selects or reads a `label` off a class", () => {
    expect(SERVICE).not.toMatch(/select\("label/);
    expect(SERVICE).not.toMatch(/\bcls\??\.label\b/);
    expect(SERVICE).not.toMatch(/\bc\.label\b/);
  });

  test("every classLabel VALUE is derived from nameBn", () => {
    // Only the sites that assign a value — `classLabel: string` declarations on
    // the two interfaces and the two signatures are types, not reads.
    const assigns = (SERVICE.match(/classLabel: (?!string[,;])[^,\n]+,/g) ?? []).filter(
      (a) => a !== "classLabel,",
    );
    expect(assigns).toEqual([
      'classLabel: cls.nameBn ?? "",',
      'classLabel: cls?.nameBn ?? "",',
      'classLabel: c.nameBn ?? "",',
    ]);
  });
});

describe("the class name travels ON the row, not only on the class view", () => {
  test("SyllabusShape carries classLabel", () => {
    expect(SERVICE).toMatch(/export interface SyllabusShape \{[\s\S]*?classLabel: string;/);
  });

  test("toShape and placeholder both take it, so no surface can forget it", () => {
    // A default value here would be the bug again: a row would claim a class it
    // has not been told about, and read as blank rather than as broken.
    expect(SERVICE).toMatch(/function toShape\([\s\S]*?classLabel: string,\n\): SyllabusShape/);
    expect(SERVICE).toMatch(/function placeholder\([\s\S]*?classLabel: string,\n\): SyllabusShape/);
  });

  test("the teacher inbox resolves names for the classes its rows span", () => {
    const fn = SERVICE.match(
      /export async function mySyllabusApprovals[\s\S]*?\n\}/,
    )?.[0];
    expect(fn).toBeDefined();
    // It is a flat list across classes, so it cannot borrow a single `cls` the
    // way the per-class readers do.
    expect(fn).toMatch(/Class\.find\(/);
    expect(fn).toMatch(/nameBn/);
  });

  test("the GraphQL type and the app's query both carry classLabel", () => {
    expect(RESOLVER).toMatch(/classLabel: t\.exposeString\("classLabel"\)/);
    // Asking for it is what actually puts it on the wire.
    expect(APP_GQL).toMatch(/const SYLLABUS_FIELDS = `[\s\S]*?\bclassLabel\b/);
    expect(APP_GQL).toMatch(/classLabel: string;/);
  });
});

describe("the approval card shows which class it is signing off", () => {
  test("the card heading renders the class, not the subject alone", () => {
    expect(SCREEN).toMatch(/row\.classLabel/);
  });

  test("the class is rendered next to the subject label", () => {
    // Both in the same heading: the pair is what identifies the row, and a
    // class shown somewhere else on the card does not disambiguate the list.
    expect(SCREEN).toMatch(/row\.classLabel[\s\S]{0,160}routineSubjectLabel\(row\.subject\)/);
  });
});
