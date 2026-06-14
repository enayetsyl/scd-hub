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

/**
 * Guardian-portal firewall (GP-1, D-#68 / prd-guardian-portal §4).
 *
 * The guardian read path is identity-plane ONLY. Fail-closed both ways:
 * the guardian module must have NO import path into the corpus plane (so a
 * guardian token can never reach analytics/export data), and the corpus
 * module must have NO import path into the guardian module (so the analytics
 * plane can never join back through guardian-scoped identity reads).
 */
describe("Guardian-portal firewall (ADR-005 / GP-1)", () => {
  const guardianDir = path.resolve(__dirname, "../modules/guardian");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("guardian module has NO import from the corpus plane", () => {
    const files = walkDir(guardianDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (GP-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the guardian module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/guardian"));
    }
  });
});

/**
 * Notifications firewall (N-1, D-#72 / prd-notifications N5.1).
 *
 * Notification + DeviceToken rows name recipients (Users/Guardians) — strictly
 * identity-plane. Fail-closed both ways: the notifications module must have NO
 * import path into the corpus plane, and the corpus module must have NO import
 * path into the notifications module (no analytics/export join back to a
 * notification or token row).
 */
describe("Notifications firewall (ADR-005 / N5.1)", () => {
  const notificationsDir = path.resolve(__dirname, "../modules/notifications");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("notifications module has NO import from the corpus plane", () => {
    const files = walkDir(notificationsDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (N-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the notifications module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/notifications"));
      expect(content).not.toMatch(importPattern("models/Notification"));
    }
  });
});

/**
 * Assignment-tracker firewall (AS-T2/AS-T4, D-#85 / prd-tracker-assignment).
 *
 * Layer-B AssignmentStudentRecords and AssignmentFollowUps name students and
 * guardians — strictly identity-plane (same posture as HomeworkStudentRecord).
 * Fail-closed: the corpus module must have NO import path to any assignment
 * model (no analytics/export join back to a per-student assignment row).
 */
describe("Assignment-tracker firewall (ADR-005 / D-#85)", () => {
  const corpusDir = path.resolve(__dirname, "../modules/corpus");
  const ASSIGNMENT_MODELS = [
    "models/AssignmentSchedule",
    "models/AssignmentItem",
    "models/AssignmentStudentRecord",
    "models/AssignmentFollowUp",
    "models/AssignmentSequence",
  ];

  test("corpus module has NO import of any assignment model", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      for (const model of ASSIGNMENT_MODELS) {
        expect(content).not.toMatch(importPattern(model));
      }
    }
  });
});

/**
 * Library firewall (LB-1..LB-5, D-#81–#84 / prd-library §9).
 *
 * Every library row (a child's reading record included) is identity-plane
 * (ADR-005). Fail-closed both ways: the library module must have NO import
 * path into the corpus plane, and the corpus module must have NO import path
 * into the library module (no analytics/export join back to who read what).
 */
describe("Library firewall (ADR-005 / D-#81)", () => {
  const libraryDir = path.resolve(__dirname, "../modules/library");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("library module has NO import from the corpus plane", () => {
    const files = walkDir(libraryDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (LB-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the library module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/library"));
      expect(content).not.toMatch(importPattern("models/BookLoan"));
      expect(content).not.toMatch(importPattern("models/BookReservation"));
    }
  });
});

/**
 * Chat/messaging firewall (M-1, D-#76 / prd-messaging §8).
 *
 * Every chat row (conversations, memberships, messages, receipts) names staff
 * Users — strictly identity-plane (ADR-005). Fail-closed both ways: the chat
 * module must have NO import path into the corpus plane, and the corpus module
 * must have NO import path into the chat module (no analytics/export join back
 * to who said what to whom).
 */
describe("Chat firewall (ADR-005 / D-#76)", () => {
  const chatDir = path.resolve(__dirname, "../modules/chat");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("chat module has NO import from the corpus plane", () => {
    const files = walkDir(chatDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (M-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the chat module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/chat"));
      expect(content).not.toMatch(importPattern("models/Conversation"));
      expect(content).not.toMatch(importPattern("models/ChatMessage"));
      expect(content).not.toMatch(importPattern("models/MessageReceipt"));
      expect(content).not.toMatch(importPattern("models/Reaction"));
      expect(content).not.toMatch(importPattern("models/GuardianNotice"));
    }
  });
});

/**
 * HR staff-leave firewall (HR-2, prd-hr §1/H7.4 / ADR-005).
 *
 * HR is the most sensitive identity-bearing plane (leave, balances, cover). The
 * leave module names StaffProfiles/Users — strictly identity-plane. Fail-closed
 * both ways: the hr module must have NO import path into the corpus plane, and the
 * corpus module must have NO import path into the hr module or its leave models
 * (no analytics/export join back to who took what leave).
 */
describe("HR staff-leave firewall (ADR-005 / prd-hr H7.4)", () => {
  const hrDir = path.resolve(__dirname, "../modules/hr");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("hr module has NO import from the corpus plane", () => {
    const files = walkDir(hrDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (HR-2 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the hr module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/hr"));
      expect(content).not.toMatch(importPattern("models/StaffLeaveApplication"));
      expect(content).not.toMatch(importPattern("models/StaffLeaveEntitlement"));
      expect(content).not.toMatch(importPattern("models/StaffCoverSlot"));
      expect(content).not.toMatch(importPattern("models/PayrollRun"));     // HR-3 payroll (most-sensitive plane, §4.7)
      expect(content).not.toMatch(importPattern("models/Payslip"));
      expect(content).not.toMatch(importPattern("models/AdvanceLoan"));
      expect(content).not.toMatch(importPattern("models/Observation"));    // HR-4 performance/conduct/development (satr, H5.5/H7.3)
      expect(content).not.toMatch(importPattern("models/Appraisal"));
      expect(content).not.toMatch(importPattern("models/ConductRecord"));
      expect(content).not.toMatch(importPattern("models/Grievance"));
      expect(content).not.toMatch(importPattern("models/DevelopmentLog"));
      expect(content).not.toMatch(importPattern("models/OffboardingCase")); // HR-5 offboarding (exit/settlement/clearance, H6/H7.1)
    }
  });
});

/**
 * Vocabulary-tracker firewall (VC-1, D-#104 / prd-vocabulary-tracker §1/§5).
 *
 * The vocab tracker is identity/operational plane (ADR-005). The VC-1 word bank
 * itself is shared content, but the module grows to hold per-student results
 * (VC-3) and guardian messaging (VC-4) — so it is firewall-isolated from the
 * corpus plane from the start. Fail-closed both ways: the vocab module must have
 * NO import path into the corpus plane, and the corpus module must have NO import
 * path into the vocab module (no analytics/export join back to who scored what).
 */
describe("Vocabulary-tracker firewall (ADR-005 / VC-1, D-#104)", () => {
  const vocabDir = path.resolve(__dirname, "../modules/vocab");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("vocab module has NO import from the corpus plane", () => {
    const files = walkDir(vocabDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (VC-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the vocab module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/vocab"));
      expect(content).not.toMatch(importPattern("models/VocabWord"));
      expect(content).not.toMatch(importPattern("models/VocabTest"));          // VC-2 tests (per-section)
      expect(content).not.toMatch(importPattern("models/VocabTestPosition"));
      expect(content).not.toMatch(importPattern("models/VocabTestAssignment"));
      expect(content).not.toMatch(importPattern("models/VocabStudentResult"));  // VC-3 per-student marks (names studentIds)
      expect(content).not.toMatch(importPattern("models/VocabStudentTest"));
    }
  });
});

/**
 * Message-templates firewall (MT-1, D-#128 / prd-message-templates §3/§10).
 *
 * A template body is shared operational content, but the module sits on the
 * identity/operational plane (ADR-005) and must never become an analytics join
 * surface. Fail-closed both ways: the templates module must have NO import path
 * into the corpus plane, and the corpus module must have NO import path into the
 * templates module or its MessageTemplate model.
 */
describe("Message-templates firewall (ADR-005 / MT-1, D-#128)", () => {
  const templatesDir = path.resolve(__dirname, "../modules/templates");
  const corpusDir = path.resolve(__dirname, "../modules/corpus");

  test("templates module has NO import from the corpus plane", () => {
    const files = walkDir(templatesDir);
    expect(files.length).toBeGreaterThan(0); // the module exists (MT-1 shipped)
    for (const f of files) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
    }
  });

  test("corpus module has NO import from the templates module", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/templates"));
      expect(content).not.toMatch(importPattern("models/MessageTemplate"));
    }
  });
});

/**
 * Class-test tracker firewall (CT-1, D-#119 / prd-tracker-class-test §10/§11).
 *
 * The ClassTest header + per-student results (CT-2) name students/sections —
 * strictly identity/operational plane (ADR-005), same posture as the homework /
 * assignment trackers. Fail-closed BOTH ways: the corpus module must have NO
 * import path to any class-test model (no analytics/export join back to who sat
 * which exam), and the class-test source files must have NO import into the
 * corpus plane.
 */
describe("Class-test tracker firewall (ADR-005 / CT-1, D-#119)", () => {
  const corpusDir = path.resolve(__dirname, "../modules/corpus");
  const CLASS_TEST_MODELS = [
    "models/ClassTest",
    "models/ClassTestSequence",
    "models/ClassTestResult", // CT-2 per-student results (names studentIds)
  ];
  const CLASS_TEST_FILES = [
    "../modules/trackers/models/ClassTest.ts",
    "../modules/trackers/models/ClassTestSequence.ts",
    "../modules/trackers/models/ClassTestResult.ts",
    "../modules/trackers/services/ClassTestService.ts",
    "../modules/trackers/services/ClassTestFileService.ts",
    "../modules/trackers/services/ClassTestResultService.ts",
    "../modules/trackers/classTestScoring.ts",
    "../modules/trackers/classTestCalendar.ts",
    "../modules/trackers/resolvers/classTest.ts",
    "../modules/trackers/resolvers/classTestResult.ts",
  ].map((p) => path.resolve(__dirname, p));

  test("corpus module has NO import of any class-test model", () => {
    for (const f of walkDir(corpusDir)) {
      const content = fs.readFileSync(f, "utf8");
      for (const model of CLASS_TEST_MODELS) {
        expect(content).not.toMatch(importPattern(model));
      }
    }
  });

  test("class-test source files have NO import from the corpus plane", () => {
    for (const f of CLASS_TEST_FILES) {
      expect(fs.existsSync(f)).toBe(true); // the file shipped (CT-1)
      const content = fs.readFileSync(f, "utf8");
      expect(content).not.toMatch(importPattern("modules/corpus"));
      expect(content).not.toMatch(importPattern("models/CorpusEvent"));
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
