/**
 * GraphQL document ⇄ schema gate (owner ask 2026-08-03).
 *
 * WHY THIS EXISTS: on 2026-08-03 a `retired` argument was added to the SHARED arg
 * constants in `app/src/graphql/classTest.ts`, but the argument exists on only one
 * server field. Two other queries interpolate those constants, so they sent an
 * argument they do not declare and GraphQL rejected the whole document — the
 * Class-test dashboard rendered nothing but "Unknown argument retired". It reached
 * PRODUCTION with typecheck, the vocab verifier, 2842 tests and the Expo web export
 * all green, because a GraphQL document is a plain STRING validated at RUNTIME
 * against the server schema, and nothing in the gate looked at it.
 *
 * This closes that hole: build the REAL schema, then run graphql-js `validate` over
 * every document the app ships. It catches unknown fields, unknown/missing arguments,
 * wrong types and bad selection sets — for every query, mutation and fragment — on
 * every push.
 *
 * The app's `gql` comes from urql, which parses at import time, so these are real
 * DocumentNodes; no string scraping, which matters because several documents are
 * built by template interpolation (exactly the mechanism that broke).
 *
 * The module list is READ FROM DISK, not hardcoded: a new `app/src/graphql/*.ts`
 * file is covered the day it is added, with nobody having to remember this file.
 */
import { readdirSync } from "fs";
import { join } from "path";
import { validate, print, type DocumentNode, type GraphQLSchema } from "graphql";

// Registers every field on the shared Pothos builder (side-effect import).
import "../registerResolvers";
import { builder } from "../schema";

const GRAPHQL_DIR = join(__dirname, "..", "..", "..", "app", "src", "graphql");

/**
 * The one file here that ships no documents: it builds the urql client and imports
 * `react-native`, which this node-environment suite cannot parse. Excluded BY NAME on
 * purpose — a blanket try/catch would let a real document module drop silently out of
 * the gate the day someone adds an RN import to it.
 */
const NOT_DOCUMENT_MODULES = new Set(["client.ts"]);

/** Every document the app ships, keyed by "<file> → <exportName>" for readable failures. */
function collectDocuments(): Array<{ where: string; doc: DocumentNode }> {
  const out: Array<{ where: string; doc: DocumentNode }> = [];
  const files = readdirSync(GRAPHQL_DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !NOT_DOCUMENT_MODULES.has(f),
  );
  expect(files.length).toBeGreaterThan(0); // a silent empty sweep would pass forever

  for (const file of files) {
    // Deliberately NOT wrapped in try/catch: an import failure must fail the gate, not
    // quietly shrink its coverage.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(join(GRAPHQL_DIR, file)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (!value || typeof value !== "object") continue;
      const node = value as { kind?: string; definitions?: unknown[] };
      if (node.kind !== "Document" || !Array.isArray(node.definitions)) continue;
      out.push({ where: `${file} → ${name}`, doc: value as DocumentNode });
    }
  }
  return out;
}

/**
 * KNOWN-BAD, quarantined 2026-08-03 — the seven documents this gate found already
 * broken on its very first run. All in finance.ts, all rejected wholesale by the
 * server today (so those screens do not work in prod):
 *
 *   RECORD_FINANCE_POSTING        Unknown type "FeeLineInput" (server: FinanceFeeLineInput),
 *                                 Unknown type "SalaryAdjustmentInput"
 *                                 (server: FinanceSalaryAdjustmentInput), $mode nullable
 *                                 vs String!
 *   SET_FEE_SUPPORT_ALLOCATION    Unknown type "FeeCoverageInput"
 *                                 (server: FinanceCoverageItemInput)
 *   RECORD_RECONCILIATION         Unknown type "EximusClosingInput"
 *   RECORD_PROVIDER_RECEIPT       $mode nullable vs String!
 *   RECORD_QARD_IOU_ENTRY         $mode nullable vs String!
 *   LATEST_RECONCILIATION_QUERY   $date nullable vs String!
 *   RECONCILIATION_HISTORY_QUERY  $from/$to nullable vs String!
 *
 * They are quarantined rather than fixed here ON PURPOSE: they are money mutations,
 * pre-existing, and unrelated to the change that added this gate — they deserve their
 * own reviewed fix, not a drive-by rename buried in a feature PR.
 *
 * This is NOT a soft allowlist. The test below asserts each entry is STILL failing, so
 * a fixed document breaks the build until it is removed from this list, and the list
 * can never quietly absorb a new regression.
 */
const QUARANTINE = new Set([
  "finance.ts → RECORD_FINANCE_POSTING",
  "finance.ts → SET_FEE_SUPPORT_ALLOCATION",
  "finance.ts → RECORD_RECONCILIATION",
  "finance.ts → RECORD_PROVIDER_RECEIPT",
  "finance.ts → RECORD_QARD_IOU_ENTRY",
  "finance.ts → LATEST_RECONCILIATION_QUERY",
  "finance.ts → RECONCILIATION_HISTORY_QUERY",
]);

let schema: GraphQLSchema;
let documents: Array<{ where: string; doc: DocumentNode }>;

beforeAll(() => {
  schema = builder.toSchema();
  documents = collectDocuments();
});

describe("every app GraphQL document validates against the server schema", () => {
  test("the sweep actually found documents (guards against a silently empty gate)", () => {
    expect(documents.length).toBeGreaterThan(20);
  });

  test("every quarantined document is STILL broken — fix one, remove it from the list", () => {
    const fixed = [...QUARANTINE].filter((where) => {
      const entry = documents.find((d) => d.where === where);
      // Gone from the app entirely also counts as no longer needing quarantine.
      return !entry || validate(schema, entry.doc).length === 0;
    });
    expect({ nowValid: fixed }).toEqual({ nowValid: [] });
  });

  test("no document has a validation error", () => {
    const failures: string[] = [];
    for (const { where, doc } of documents) {
      if (QUARANTINE.has(where)) continue;
      const errors = validate(schema, doc);
      if (errors.length === 0) continue;
      failures.push(
        `\n✗ ${where}\n` +
          errors.map((e) => `    ${e.message}`).join("\n") +
          `\n  document:\n${print(doc)
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")}`,
      );
    }
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} GraphQL document(s) do not match the server schema.\n` +
          `This is the class of bug that broke the Class-test dashboard in prod on 2026-08-03 —\n` +
          `fix the document or add the field/argument to the resolver before merging.\n` +
          failures.join("\n"),
      );
    }
  });
});
