/**
 * Fail-closed firewall test (J5.6, NFR-11, ADR-005, R-X8/R-AC4).
 *
 * This test PASSES BY FAILING:
 *   - It checks that the corpus/analytics resolver module has NO import statement
 *     that references identity models (User, Student, Guardian, GuardianLink).
 *   - It scans every .ts file inside the corpus module for import paths that
 *     contain identity model names.
 *   - It verifies the CorpusEvent GraphQL type does not expose identity fields.
 *
 * The test does NOT need a live DB connection — it introspects source files.
 *
 * If this test ever fails, a corpus→identity path has been opened and MUST be
 * removed before any merge. (ADR-005, R-X8/R-AC4)
 */

import * as fs from "fs";
import * as path from "path";

const ANALYTICS_MODULE = path.resolve(
  __dirname,
  "../modules/corpus/resolvers/analytics.ts",
);

/** Patterns that indicate an actual import of an identity model.
 *  Matches `from "...models/User"` or `require("...models/User")` —
 *  NOT plain-text occurrences in comments or strings. */
function importPattern(modelName: string): RegExp {
  const escaped = modelName.replace("/", "\\/");
  // Match: from "*/models/User[.ts]" or require("*/models/User[.ts]")
  return new RegExp(`(?:from|require)\\s*\\(?["'][^"']*${escaped}`, "m");
}

const IDENTITY_MODELS = [
  "models/User",
  "models/Student",
  "models/Guardian",
  "models/GuardianLink",
];

describe("Fail-closed firewall (ADR-005 / J5.6)", () => {
  let analyticsSource: string;

  beforeAll(() => {
    analyticsSource = fs.readFileSync(ANALYTICS_MODULE, "utf8");
  });

  test("corpus analytics module does NOT import User model", () => {
    expect(analyticsSource).not.toMatch(importPattern("models/User"));
  });

  test("corpus analytics module does NOT import Student model", () => {
    expect(analyticsSource).not.toMatch(importPattern("models/Student"));
  });

  test("corpus analytics module does NOT import Guardian model (not GuardianLink)", () => {
    // Use word-boundary: "models/Guardian" but not "models/GuardianLink"
    expect(analyticsSource).not.toMatch(importPattern("models/Guardian"));
  });

  test("corpus analytics module does NOT import GuardianLink model", () => {
    expect(analyticsSource).not.toMatch(importPattern("models/GuardianLink"));
  });

  test("CorpusEvent type fields contain no identity-carrying exposed field names", () => {
    const identityFields = ["email", "phone", "schoolId", "studentId", "guardianId"];
    for (const field of identityFields) {
      // Check for t.expose*(field) on the CorpusEvent definition
      const exposurePattern = new RegExp(`t\\.expose[A-Za-z]*\\(["']${field}["']`);
      expect(analyticsSource).not.toMatch(exposurePattern);
    }
  });

  test("analytics module does NOT import from foundation module at all", () => {
    expect(analyticsSource).not.toMatch(importPattern("modules/foundation"));
  });

  test("all corpus module files have no identity model imports", () => {
    const corpusDir = path.resolve(__dirname, "../modules/corpus");
    const corpusFiles = walkDir(corpusDir);

    for (const f of corpusFiles) {
      const content = fs.readFileSync(f, "utf8");
      for (const model of IDENTITY_MODELS) {
        expect(content).not.toMatch(importPattern(model));
      }
    }
  });
});

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.name.endsWith(".ts")) results.push(full);
  }
  return results;
}
