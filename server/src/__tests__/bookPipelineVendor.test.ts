/**
 * The vendored render pipeline (SB-4, D-#407/#413).
 *
 * A vendored tree rots quietly: a file gets missed in the copy, or a font is dropped
 * to keep the repo small, and nobody finds out until a render either fails to launch
 * or — far worse — succeeds and prints tofu. `fonts.js` throws on a missing TTF
 * precisely so that failure is loud, but only if the TTF is actually meant to be
 * there. This pins what "there" means.
 */
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..", "..", "book-pipeline");

describe("the vendored pipeline is complete", () => {
  it("carries both entry points the runner spawns", () => {
    for (const f of ["src/validate-studybook.js", "src/build-book.js"]) {
      expect(existsSync(path.join(ROOT, f))).toBe(true);
    }
  });

  it("carries every lib the entry points require", () => {
    // A missing lib is a runtime crash inside a spawned process, which surfaces as an
    // opaque non-zero exit rather than a stack trace anyone will read.
    for (const f of ["geometry.js", "profiles.js", "compose.js", "fonts.js", "font-audit.js"]) {
      expect(existsSync(path.join(ROOT, "src", "lib", f))).toBe(true);
    }
  });

  it("carries all FOUR Noto faces, non-empty", () => {
    // The single most important correctness piece for Bengali: four embedded faces or
    // throw, no OS fallback (ASSEMBLY §2). Three faces renders; it just renders wrong.
    const fonts = [
      "NotoSerifBengali-Regular.ttf", "NotoSerifBengali-Bold.ttf",
      "NotoSerif-Regular.ttf", "NotoSerif-Bold.ttf",
    ];
    for (const f of fonts) {
      const p = path.join(ROOT, "fonts", f);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(50_000);
    }
  });

  it("carries the compliance strips the image tools apply", () => {
    for (const s of ["strip-a.png", "strip-b.png", "strip-c.png", "strip-d.png"]) {
      expect(existsSync(path.join(ROOT, "strips", s))).toBe(true);
    }
  });

  it("skips the Puppeteer browser download", () => {
    // The host is aarch64 and Puppeteer publishes no linux-arm64 Chromium, so the
    // download is not merely wasteful — it cannot produce anything launchable.
    const npmrc = readFileSync(path.join(ROOT, ".npmrc"), "utf8");
    expect(npmrc).toMatch(/puppeteer_skip_download\s*=\s*true/);
  });

  it("does NOT carry real book content — that lives in the database (D-#403/#406)", () => {
    expect(existsSync(path.join(ROOT, "content"))).toBe(false);
    expect(existsSync(path.join(ROOT, "out"))).toBe(false);
  });
});

describe("it is deliberately NOT an npm workspace", () => {
  it("stays out of the root workspaces list", () => {
    // As a workspace, every npm install and every CI run would pull puppeteer + sharp
    // for a package CI never executes.
    const root = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
      workspaces?: string[];
    };
    expect(root.workspaces ?? []).not.toContain("book-pipeline");
    for (const w of root.workspaces ?? []) expect(w.startsWith("book-pipeline")).toBe(false);
  });

  it("still declares its own deps, so the render host can install them", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(expect.arrayContaining(["puppeteer", "sharp"]));
  });
});

describe("nothing in the app imports from the vendored tree (D-#407)", () => {
  it("the runner spawns it and never requires it", () => {
    const runner = readFileSync(
      path.join(__dirname, "..", "modules", "support-book", "services", "BookRenderRunner.ts"),
      "utf8",
    );
    // An import would couple the app to CommonJS internals of a tree we promised not
    // to modify — and would make "never ported" a matter of intent rather than fact.
    expect(runner).not.toMatch(/from\s+["'].*book-pipeline/);
    expect(runner).not.toMatch(/require\(["'].*book-pipeline/);
    expect(runner).toContain("execFile");
  });
});
