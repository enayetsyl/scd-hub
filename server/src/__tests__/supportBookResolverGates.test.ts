/**
 * Support-book resolver gates (SB-1, D-#405/#424).
 *
 * A STATIC guard over the resolver source, in the spirit of the expected-error
 * registry and the nav-initial-route guard: it reads the file and asserts that every
 * `builder.queryField` / `builder.mutationField` declares an `authScopes` with a
 * `book:*` permission.
 *
 * Why static rather than executing the schema: an ungated field is a mistake of
 * OMISSION, and the only reliable way to catch an omission is to enumerate what
 * exists and check each one. A runtime test can only probe the fields someone
 * remembered to write a case for — which is exactly the field that will be missing.
 *
 * `MergeService` and `PolicySetService` carry no permission checks by design; this
 * boundary is the only thing standing between them and an unauthenticated caller.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";

/** EVERY resolver file in the module — reading one named file would silently stop
 *  covering a new one, which is the same class of omission this guard exists to catch. */
const DIR = path.join(__dirname, "..", "modules", "support-book", "resolvers");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
const source = FILES.map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");

/** Every `builder.(query|mutation)Field("name"` with the slice of source that follows,
 *  up to the next field declaration — enough to see its authScopes. */
function fields(): Array<{ kind: string; name: string; body: string }> {
  const re = /builder\.(query|mutation)Field\(\s*"([^"]+)"/g;
  const hits: Array<{ kind: string; name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    hits.push({ kind: m[1], name: m[2], start: m.index });
  }
  return hits.map((h, i) => ({
    kind: h.kind,
    name: h.name,
    body: source.slice(h.start, i + 1 < hits.length ? hits[i + 1].start : source.length),
  }));
}

describe("support-book resolvers — every field is permission-gated", () => {
  const all = fields();

  it("finds the expected fields (guard is actually reading the file)", () => {
    // If this drops to zero the whole suite would vacuously pass.
    expect(all.length).toBeGreaterThanOrEqual(9);
    expect(FILES.length).toBeGreaterThanOrEqual(2);
    const names = all.map((f) => f.name);
    expect(names).toContain("submitSupportBookPatch");
    expect(names).toContain("createSupportBook");
    expect(names).toContain("supportBooks");
    expect(names).toContain("supportBookSlots");
    expect(names).toContain("supportBookStaleness");
  });

  it.each(fields().map((f) => [f.kind, f.name] as const))(
    "%s field %s declares an authScopes with a book:* permission",
    (_kind, name) => {
      const f = all.find((x) => x.name === name)!;
      expect(f.body).toMatch(/authScopes:\s*\{\s*hasPermission:\s*"book:[a-z_]+"\s*\}/);
    },
  );

  it("writes go to book:author or book:manage — never to book:read", () => {
    for (const f of all.filter((x) => x.kind === "mutation")) {
      const m = f.body.match(/hasPermission:\s*"(book:[a-z_]+)"/);
      expect(m).not.toBeNull();
      expect(["book:author", "book:manage", "book:illustrate", "book:review", "book:review_senior", "book:assemble"])
        .toContain(m![1]);
    }
  });

  it("every field checks the book plane is configured before querying it", () => {
    // A buffered query against an unopened connection never drains — the caller
    // would hang rather than be told the plane is not provisioned (D-#404).
    for (const f of all) {
      expect(f.body).toContain("assertBookPlane()");
    }
  });

  it("no resolver reaches an identity model across the plane boundary (D-#404)", () => {
    for (const bad of ["models/User", "models/Student", "models/Guardian", "models/StaffProfile"]) {
      expect(source).not.toContain(bad);
    }
  });

  it("the patch mutation accepts only the two real sources (D-#419/#408)", () => {
    // Anything else is a caller bug, not a new authoring path.
    expect(source).toMatch(/IN_APP_CHAT.*:\s*"DESKTOP_UPLOAD"/s);
  });
});

describe("image doctrine — enforced by omission (README §5)", () => {
  it("no resolver READS compliance_note off a slot", () => {
    // The white stripe is applied programmatically AFTER generation. Telling an
    // illustrator where it lands is the surest way to get one drawn in.
    //
    // Assert the ACCESS, not the word: the field is discussed at length in the
    // comments precisely because its absence is deliberate, so a bare substring match
    // would fail on the documentation explaining why it is missing.
    expect(source).not.toMatch(/\.compliance_note\b/);
    expect(source).not.toMatch(/\[["']compliance_note["']\]/);
    expect(source).not.toMatch(/complianceNote/);
  });

  it("the slot workspace exposes the prompt and refs the illustrator needs", () => {
    for (const field of ["sceneDescription", "prompt", "refs", "containsLivingBeing", "aspect"]) {
      expect(source).toContain(field);
    }
  });

  it("staleness is surfaced on the slot itself, not only in the build report", () => {
    // An illustrator should see that their re-approval left work downstream, at the
    // moment they look at the slot — not discover it when a build fails days later.
    expect(source).toContain("hasStale");
  });
});
