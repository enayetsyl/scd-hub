/**
 * Book-plane isolation (SB-1, D-#404) — the structural half of the firewall.
 *
 * prd-support-book §5 SB-1 acceptance: "Book models live on a second connection; a
 * deliberate populate("User") from a book model fails loudly in a test (isolation is
 * structural, not conventional)."
 *
 * These assertions are cheap and boring, which is the point: they fail the moment
 * someone registers a book model on the default connection, or adds a `ref: "User"`
 * that would quietly re-couple the two planes. No live database is touched — the
 * facts under test are about MODEL REGISTRATION, not about data.
 */
import mongoose from "mongoose";
import { bookConnection, isBookDbReady, BookDbNotConfiguredError, connectBookDb } from "../bookDb";
import { PolicyDoc } from "../modules/support-book/models/PolicyDoc";
import { SupportBook } from "../modules/support-book/models/SupportBook";
import { SupportBookLesson } from "../modules/support-book/models/SupportBookLesson";
import { LessonPatch } from "../modules/support-book/models/LessonPatch";
import { BookEvent } from "../modules/support-book/models/BookEvent";

const BOOK_MODELS = [PolicyDoc, SupportBook, SupportBookLesson, LessonPatch, BookEvent];

describe("book plane — separate connection (D-#404)", () => {
  it("every book model is registered on the book connection, not the default one", () => {
    for (const model of BOOK_MODELS) {
      expect(model.db).toBe(bookConnection);
      expect(model.db).not.toBe(mongoose.connection);
    }
  });

  it("the book connection is a different object from the identity connection", () => {
    expect(bookConnection).not.toBe(mongoose.connection);
  });

  it("the book connection knows NO identity models — a cross-plane populate cannot resolve", () => {
    // The failure mode this guards: someone adds `ref: "User"` to a book schema and
    // calls .populate(). Mongoose resolves refs against the model's OWN connection,
    // so the lookup throws MissingSchemaError rather than silently reaching identity.
    const registered = bookConnection.modelNames();
    for (const identityModel of ["User", "Student", "Guardian", "GuardianLink", "StaffProfile"]) {
      expect(registered).not.toContain(identityModel);
    }
    expect(() => bookConnection.model("User")).toThrow();
  });

  it("no book schema declares a ref into the identity plane", () => {
    // A `ref` that names an identity model would compile and pass review; it only
    // fails at runtime, on the one query that uses it. Assert it at build time.
    const IDENTITY = new Set(["User", "Student", "Guardian", "GuardianLink", "StaffProfile", "Section", "Class"]);
    for (const model of BOOK_MODELS) {
      model.schema.eachPath((pathName, schemaType) => {
        const opts: Record<string, unknown> = schemaType.options || {};
        const ref = opts.ref;
        if (typeof ref === "string" && IDENTITY.has(ref)) {
          throw new Error(`${model.modelName}.${pathName} refs identity model "${ref}" across the plane boundary (D-#404)`);
        }
      });
    }
  });

  it("is not ready until opened, and refuses to open without a URI", async () => {
    expect(isBookDbReady()).toBe(false);
    const prior = process.env.BOOK_MONGODB_URI;
    delete process.env.BOOK_MONGODB_URI;
    await expect(connectBookDb()).rejects.toBeInstanceOf(BookDbNotConfiguredError);
    if (prior !== undefined) process.env.BOOK_MONGODB_URI = prior;
  });
});

describe("book plane — merge-key integrity (D-#406/#408)", () => {
  it("a lesson is unique per (bookId, lessonNo) — wholesale merge must hit one row", () => {
    const idx = SupportBookLesson.schema.indexes();
    const unique = idx.find(([fields, opts]) =>
      (opts as { unique?: boolean } | undefined)?.unique === true &&
      Object.keys(fields).join(",") === "bookId,lessonNo");
    expect(unique).toBeDefined();
  });

  it("a patch id is unique per book — a repeat upload cannot merge twice", () => {
    const idx = LessonPatch.schema.indexes();
    const unique = idx.find(([fields, opts]) =>
      (opts as { unique?: boolean } | undefined)?.unique === true &&
      Object.keys(fields).join(",") === "bookId,patchId");
    expect(unique).toBeDefined();
  });

  it("a policy document's version is unique per (docKey, bookId)", () => {
    const idx = PolicyDoc.schema.indexes();
    const unique = idx.find(([fields, opts]) =>
      (opts as { unique?: boolean } | undefined)?.unique === true &&
      Object.keys(fields).join(",") === "docKey,bookId,version");
    expect(unique).toBeDefined();
  });
});

describe("book production permissions (D-#405/#424)", () => {
  it("the Principal template holds all seven book:* grants", () => {
    // Re-imported here rather than asserted in the vocab verifier because the RULING
    // is what matters: the Principal can author, illustrate, review, sign off and
    // assemble (D-#424). A future PoLP tidy-up that trims one must fail here.
    const { permissionsForRole } = require("@scd/shared");
    const principal: string[] = [...permissionsForRole("PRINCIPAL")];
    for (const p of [
      "book:read", "book:author", "book:illustrate",
      "book:review", "book:review_senior", "book:assemble", "book:manage",
    ]) {
      expect(principal).toContain(p);
    }
  });

  it("no book:* permission is RESERVED — they exist to be granted per user", () => {
    const { RESERVED_PERMISSIONS } = require("@scd/shared");
    for (const r of RESERVED_PERMISSIONS as string[]) {
      expect(r.startsWith("book:")).toBe(false);
    }
  });

  it("no non-Principal template is silently granted a book permission", () => {
    // AC-1 hands these out per user; a template grant would give every teacher the
    // book surface by default, which is not what D-#405 ruled.
    const { permissionsForRole } = require("@scd/shared");
    for (const role of ["TEACHER", "OFFICE", "GUARDIAN"]) {
      const perms: string[] = [...permissionsForRole(role)];
      expect(perms.filter((p) => p.startsWith("book:"))).toEqual([]);
    }
  });
});
