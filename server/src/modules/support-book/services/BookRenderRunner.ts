/**
 * BookRenderRunner — spawns the VENDORED render pipeline (SB-4, D-#407/#413/#422/#423).
 *
 * The pipeline is **not ported and not modified**. ASSEMBLY §1's whole discipline is
 * that the frozen renderer core is never edited for support-book needs, and a
 * TypeScript port is a fork that drifts from the thing actually proven against a real
 * chapter. So this module writes a book folder, spawns the CLI, and reads what comes
 * back — the same shape as `docxConvert`'s LibreOffice call, at larger scale.
 *
 * `execFile` with an ARGUMENT ARRAY and `shell: false`, never a composed string: the
 * paths carry a book id and a Bangla filename, and PowerShell/sh quoting is exactly
 * where that goes wrong.
 *
 * ── HOST NOTES (measured, D-#413/#423) ────────────────────────────────────────
 * The VM is aarch64 and **Puppeteer publishes no bundled Chromium for linux-arm64**,
 * so `npm install puppeteer` yields a library with nothing to launch. The fix is a
 * system Chromium plus `PUPPETEER_EXECUTABLE_PATH` — an ENV VAR, which is precisely
 * why it is the acceptable fix: the vendored renderer stays byte-identical.
 *
 * **IT MUST NOT BE THE SNAP** (D-#435). Ubuntu 24.04 arm64 offers Chromium only as a
 * snap, and snapd refuses to launch one from inside a systemd SERVICE cgroup:
 * "…is not a snap cgroup for tag snap.chromium.chromium". A `systemd-run` probe passes
 * — transient units are tolerated — so this survives exactly the check that looks
 * rigorous. Use a non-snap binary (the Playwright arm64 build at
 * /opt/chromium-pw/chrome-linux/chrome).
 *
 * `pdffonts` (poppler) and `soffice` are already installed; `python3-pil` is the one
 * package the Python image tools still need. Upscaling is sharp everywhere (D-#422).
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* No RenderError class: a failed render is a RESULT (`ok: false` + a reason the
 * caller shows the assembler), not an exception. An unused error class would also
 * have to be classified in the D-#387 registry, which is a decision about alerting
 * for something that never fires. */

/** Where the vendored pipeline lives. Configurable so a worktree, the VM and a
 *  developer laptop can each point at their own copy without a code change. */
export const PIPELINE_ROOT = process.env.BOOK_PIPELINE_ROOT ?? "book-pipeline";

/**
 * Where the temp book folder is written — and this is NOT a preference (SB-4, D-#434).
 *
 * MEASURED ON THE VM, 2026-08-02: the only Chromium available on Ubuntu 24.04 aarch64
 * is the **snap**, and a snap gets a PRIVATE /tmp namespace. Chromium therefore cannot
 * see anything this process writes to the host's `/tmp` — the page simply fails to
 * load, which surfaces as an empty render or an opaque non-zero exit that says nothing
 * about namespaces. It reads `$HOME` fine (verified under `systemd-run` as the service
 * user with the service's environment).
 *
 * So the work root is configurable and the deploy host points it at a directory the
 * snap can actually read. `os.tmpdir()` stays the default because it is right
 * everywhere that is not a confined snap — a laptop, CI, a container.
 */
export const WORK_ROOT = process.env.BOOK_WORK_ROOT || tmpdir();

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The spawn seam. Injectable so the sequencing can be tested without Chromium — the
 *  ORDER of validate → build and the fail-fast behaviour are logic worth pinning even
 *  where the renderer itself cannot run in CI. */
export type CommandRunner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<CommandResult>;

/** Real spawn: argument array, no shell, output captured whatever the exit code. */
export const defaultRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 32 * 1024 * 1024, shell: false },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number"
          ? ((err as { code: number }).code)
          : err ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

export interface RenderInput {
  bookId: string;
  bookJson: Record<string, unknown>;
  /** slotId/filename → PNG bytes, written into images-compliant/. */
  images: Map<string, Buffer>;
  /** Appended as each command finishes; the caller streams it over SSE (D-#418). */
  onLog?: (chunk: string) => void;
  runner?: CommandRunner;
  timeoutMs?: number;
}

export interface RenderOutput {
  ok: boolean;
  validatorLog: string;
  buildLog: string;
  /** Absolute paths of the produced PDFs, in the order the pipeline emitted them. */
  pdfPaths: string[];
  failureReason?: string;
  /** The temp folder, so the caller can read PDFs then clean up. */
  workDir: string;
}

/**
 * Materialize → validate → build.
 *
 * **The validator runs FIRST and a non-zero exit stops the render.** That ordering is
 * the pipeline's own (ASSEMBLY §4) and it matters for a boring reason: Chromium is the
 * expensive step, and a book that fails a JSON check has no business reaching it.
 *
 * The caller is responsible for `cleanup(workDir)` — the PDFs live there until they
 * have been read and uploaded to Drive.
 */
export async function renderBook(input: RenderInput): Promise<RenderOutput> {
  const runner = input.runner ?? defaultRunner;
  const timeoutMs = input.timeoutMs ?? 15 * 60_000; // a 54-lesson book is minutes
  const log = (s: string): void => input.onLog?.(s);

  // WORK_ROOT, not tmpdir(): a snap Chromium cannot see the host's /tmp. See the
  // constant's comment — this line is the whole reason it exists.
  await mkdir(WORK_ROOT, { recursive: true }).catch(() => undefined);
  const workDir = await mkdtemp(join(WORK_ROOT, `scdbook-${input.bookId}-`));
  const imagesDir = join(workDir, "images-compliant");
  await mkdir(imagesDir, { recursive: true });

  const bookPath = join(workDir, "book.json");
  await writeFile(bookPath, JSON.stringify(input.bookJson, null, 2), "utf8");
  for (const [name, bytes] of input.images) {
    await writeFile(join(imagesDir, name), bytes);
  }
  log(`materialized ${input.bookId}: ${input.images.size} images → ${workDir}\n`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  // See the header: without this the launch fails on ARM with a message that does not
  // mention architecture at all.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    env.PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // ---- 1. validate (cheap, and it gates the expensive step) ----
  const v = await runner(
    "node",
    ["src/validate-studybook.js", bookPath, "--images", imagesDir],
    { cwd: PIPELINE_ROOT, env, timeoutMs },
  );
  const validatorLog = v.stdout + v.stderr;
  log(validatorLog);
  if (v.code !== 0) {
    return {
      ok: false,
      validatorLog,
      buildLog: "",
      pdfPaths: [],
      failureReason: "validator refused the book — nothing was rendered",
      workDir,
    };
  }

  // ---- 2. build (both editions; ANY failure fails the whole job, ASSEMBLY §5) ----
  const outDir = join(workDir, "out");
  const b = await runner(
    "node",
    ["src/build-book.js", bookPath, "--images", imagesDir, "--out", outDir],
    { cwd: PIPELINE_ROOT, env, timeoutMs },
  );
  const buildLog = b.stdout + b.stderr;
  log(buildLog);
  if (b.code !== 0) {
    return {
      ok: false,
      validatorLog,
      buildLog,
      pdfPaths: [],
      failureReason: "render failed — see the log for the offending lesson",
      workDir,
    };
  }

  return {
    ok: true,
    validatorLog,
    buildLog,
    pdfPaths: parsePdfPaths(buildLog, outDir, input.bookId),
    workDir,
  };
}

/** The build script prints the paths it wrote; fall back to the documented convention
 *  when the output format changes rather than failing a successful render. */
export function parsePdfPaths(buildLog: string, outDir: string, bookId: string): string[] {
  const found = [...buildLog.matchAll(/(\S+\.pdf)\b/g)].map((m) => m[1]);
  if (found.length) return [...new Set(found)];
  return [
    join(outDir, bookId, `${bookId}-bn-print-colour.pdf`),
    join(outDir, bookId, `${bookId}-bn-bw-photocopy.pdf`),
  ];
}

export async function readPdf(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function cleanup(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}
