/**
 * Book-lifecycle REST routes under `/files/book-lc/*` (docs/prd-book-lifecycle.md §5.13, §15.3).
 * Under `/files` because that prefix is already in the Caddy `@api` matcher of both sites; a new
 * top-level prefix would need a VM Caddy edit.
 *
 * Uploads land in a TEMP FILE (multer disk storage), never a whole-request memory buffer; the
 * existing Drive store then reads the file once to send it (DriveStore takes a Buffer — noted in
 * the handoff as the one place a whole file is held, as every other upload route does today).
 * The read gate for `book_lc_*` kinds is `assertBookLcFileReadAccess`, dispatched in GET /files/:id
 * BEFORE the old `book_` prefix.
 */
import express, { type Request, type Response, type Router, type RequestHandler } from "express";
import multer from "multer";
import { tmpdir } from "os";
import { readFile, unlink } from "fs/promises";
import { BOOK_LC_LIMITS, type BookEdition, type BookVersionStatus } from "@scd/shared";
import { buildContext, type AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import type { IStoredFile } from "../../platform/models/StoredFile";
import { DriveUnavailableError } from "../../platform/services/DriveStore";
import { BookLcError } from "../services/errors";
import { BookMarkdownError } from "../services/markdown";
import { assertBookPlane, canBookLc, requireBookLc, uid } from "../services/access";
import { importBook, uploadNewVersionDraft, uploadVersionFile } from "../services/versionService";
import { addRoundScan, loadRound, roundMemoMarkdown } from "../services/roundService";
import { loadBook, loadVersion, servedMaster, vlabel } from "../services/store";
import { recordContentRead, lcEvent } from "../services/events";
import { mimeFromName, storeLcFile } from "../services/files";
import { SchoolBook } from "../models/SchoolBook";
import { addReleaseFile } from "../services/releaseService";
import { teacherMayRead, uploadReportPhoto } from "../services/teacherService";
import type { BookReleaseFileKind } from "@scd/shared";
import { downloadBundle, downloadTranscriptionPack, uploadBundleWhole } from "../services/bundle";
import { consumeUploadUrl } from "../services/uploadUrl";

const upload = multer({ dest: tmpdir(), limits: { fileSize: BOOK_LC_LIMITS.printBytes + 1, files: 2 } });

const parse = (fields: { name: string; maxCount: number }[]): RequestHandler => (req, res, next) => {
  upload.fields(fields)(req, res, (err: unknown) => {
    if (err) {
      res.status(422).json({ error: "ফাইল খুব বড় বা ভুল" });
      return;
    }
    next();
  });
};

type Files = Record<string, Express.Multer.File[] | undefined>;

async function take(req: Request, name: string): Promise<{ data: Buffer; name: string; mime: string } | null> {
  const f = (req.files as Files | undefined)?.[name]?.[0];
  if (!f) return null;
  try {
    const original = Buffer.from(f.originalname, "latin1").toString("utf8");
    return { data: await readFile(f.path), name: original, mime: f.mimetype && f.mimetype !== "application/octet-stream" ? f.mimetype : mimeFromName(original) };
  } finally {
    await unlink(f.path).catch(() => undefined);
  }
}

async function cleanup(req: Request): Promise<void> {
  for (const list of Object.values((req.files as Files | undefined) ?? {})) for (const f of list ?? []) await unlink(f.path).catch(() => undefined);
}

function fail(res: Response, e: unknown): void {
  if (e instanceof ForbiddenError) res.status(403).json({ error: e.message });
  else if (e instanceof BookLcError || e instanceof BookMarkdownError) res.status(422).json({ error: e.message, code: (e as BookLcError).code });
  else if (e instanceof DriveUnavailableError) res.status(503).json({ error: "এই মুহূর্তে ফাইল রাখা যাচ্ছে না (Drive)" });
  else {
    console.error("[book-lc files]", e);
    res.status(500).json({ error: "সার্ভারে সমস্যা" });
  }
}

function ctxOf(req: Request, res: Response): AppContext {
  const ctx = buildContext(req, res);
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  assertBookPlane();
  return ctx;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function registerBookLcFileRoutes(router: Router): void {
  // Import an existing book (§4.4): master .md (+ media zip) and its state.
  router.post("/book-lc/import", parse([{ name: "master", maxCount: 1 }, { name: "media", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const master = await take(req, "master");
      const media = await take(req, "media");
      if (!master) throw new BookLcError("NO_FILE", "মাস্টার .md ফাইল দিন");
      const b = req.body ?? {};
      const { book, version } = await importBook(ctx.auth!, {
        code: str(b.code).trim().toUpperCase(),
        classLevel: Number(b.classLevel),
        subject: str(b.subject),
        titleBn: str(b.titleBn),
        titleEn: str(b.titleEn) || null,
        editions: str(b.editions) ? (str(b.editions).split(",") as BookEdition[]) : null,
        chapterHeadingLevel: b.chapterHeadingLevel ? Number(b.chapterHeadingLevel) : null,
        reviewerName: str(b.reviewerName) || null,
        nextMemoNo: b.nextMemoNo ? Number(b.nextMemoNo) : null,
        version: str(b.version),
        state: (str(b.state) || "draft") as BookVersionStatus,
        changeSummaryBn: str(b.changeSummaryBn) || null,
        masterMd: master.data,
        mediaZip: media?.data ?? null,
      });
      res.json({ bookId: book._id.toString(), versionId: version._id.toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // A whole new version upload → an edit draft (never a version, VR-15).
  router.post("/book-lc/upload-version", parse([{ name: "master", maxCount: 1 }, { name: "media", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const master = await take(req, "master");
      const media = await take(req, "media");
      if (!master) throw new BookLcError("NO_FILE", "মাস্টার .md ফাইল দিন");
      const draft = await uploadNewVersionDraft(ctx.auth!, str(req.body?.bookId), { masterMd: master.data, mediaZip: media?.data ?? null });
      res.json({ draftId: draft._id.toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // Master docx/pdf or an edition file on a version (§11.1).
  router.post("/book-lc/version-file", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "ফাইল দিন");
      const role = str(req.body?.role) as "master_docx" | "master_pdf" | "edition";
      if (!["master_docx", "master_pdf", "edition"].includes(role)) throw new BookLcError("BAD_ROLE", "ফাইলের ধরন ভুল");
      const v = await uploadVersionFile(ctx.auth!, str(req.body?.versionId), { role, edition: (str(req.body?.edition) || null) as BookEdition | null, name: f.name, data: f.data, mime: f.mime });
      res.json({ versionId: v._id.toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // A scan of her returned, marked copy (§10.3).
  router.post("/book-lc/round-scan", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "স্ক্যান ফাইল দিন");
      const ret = str(req.body?.returnedAt);
      const r = await addRoundScan(ctx.auth!, str(req.body?.roundId), { name: f.name, data: f.data, mime: f.mime, returnedAt: ret ? new Date(ret) : null });
      res.json({ roundId: r._id.toString(), scanFileId: r.scanFileIds[r.scanFileIds.length - 1].toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // Offline history attachments (old memos, marked copies) — read-only files on the book page.
  router.post("/book-lc/history", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      requireBookLc(ctx.auth, "manage");
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "ফাইল দিন");
      const book = await loadBook(str(req.body?.bookId));
      const stored = await storeLcFile({ kind: "book_lc_history", name: f.name, mime: f.mime, data: f.data, bookCode: book.code, version: "history", role: "history", uploadedBy: ctx.auth!.userId });
      await SchoolBook.updateOne({ _id: book._id }, { $push: { historyFiles: { storedFileId: stored._id, label: (str(req.body?.label) || f.name).slice(0, 200) } } });
      await lcEvent({ bookId: book._id, kind: "FILE_UPLOADED", actorId: uid(ctx.auth!), summary: "history attachment added" });
      res.json({ fileId: stored._id.toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // BL-2: a print-release file (release).
  router.post("/book-lc/release-file", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "ফাইল দিন");
      const r = await addReleaseFile(ctx.auth!, str(req.body?.releaseId), { edition: str(req.body?.edition) as BookEdition, kind: str(req.body?.kind) as BookReleaseFileKind, name: f.name, data: f.data, mime: f.mime });
      res.json({ releaseId: r._id.toString() });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // BL-2: a teacher's photo of the page for a report (report + reader; ≤ 5 MB).
  router.post("/book-lc/report-photo", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "ছবি দিন");
      res.json({ fileId: await uploadReportPhoto(ctx.auth!, str(req.body?.bookId), { name: f.name, data: f.data, mime: f.mime }) });
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // BL-4: a single-use upload link for Claude Code (`curl -F file=@<path> <url>`). No session: the
  // hashed, 10-minute, size-bound token is the credential; its user is re-read and must hold manage.
  router.post("/book-lc/upload/:token", parse([{ name: "file", maxCount: 1 }]), async (req, res) => {
    try {
      const f = await take(req, "file");
      if (!f) throw new BookLcError("NO_FILE", "file missing (multipart field: file)");
      res.json(await consumeUploadUrl(String(req.params.token), { name: f.name, data: f.data, mime: f.mime }));
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // BL-3: download a bundle zip (manage). The zip is built in memory and streamed, never stored.
  router.post("/book-lc/bundle", express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const b = req.body ?? {};
      const out = await downloadBundle(ctx.auth!, str(b.bookId), { feedback: Array.isArray(b.feedback) ? b.feedback.map(String) : [], instructionIds: Array.isArray(b.instructionIds) ? b.instructionIds.map(String) : [], instructions: Array.isArray(b.instructions) ? b.instructions : [], includeMedia: !!b.includeMedia });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(out.filename)}"`);
      res.setHeader("X-Bundle-Nonce", out.nonce);
      res.setHeader("X-Draft-Id", out.draftId);
      res.setHeader("Access-Control-Expose-Headers", "X-Bundle-Nonce, X-Draft-Id, Content-Disposition");
      res.send(out.zip);
    } catch (e) {
      fail(res, e);
    }
  });

  // BL-3: a whole master.md + changes.json back into a bundle's draft.
  router.post("/book-lc/bundle-whole", parse([{ name: "master", maxCount: 1 }, { name: "changes", maxCount: 1 }]), async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const master = await take(req, "master");
      const changes = await take(req, "changes");
      if (!master || !changes) throw new BookLcError("NO_FILE", "master.md ও changes.json দুটোই দিন");
      const out = await uploadBundleWhole(ctx.auth!, str(req.body?.bookId), { nonce: str(req.body?.nonce), master: master.data, changesJson: changes.data.toString("utf8") });
      res.json(out);
    } catch (e) {
      fail(res, e);
    } finally {
      await cleanup(req);
    }
  });

  // BL-3: the return-transcription pack for a round out on paper (manage).
  router.get("/book-lc/round/:id/transcription-pack.zip", async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      const out = await downloadTranscriptionPack(ctx.auth!, req.params.id);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(out.filename)}"`);
      res.send(out.zip);
    } catch (e) {
      fail(res, e);
    }
  });

  // Download the master .md as served (audited as a content read).
  router.get("/book-lc/version/:id/master.md", async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      requireBookLc(ctx.auth, "view");
      const v = await loadVersion(req.params.id);
      const book = await loadBook(v.bookId);
      const text = await servedMaster(v);
      await recordContentRead({ bookId: book._id, versionId: v._id, userId: ctx.auth!.userId, surface: "app", what: "master.md" });
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`${book.code}_${vlabel(v)}.md`)}"`);
      res.send(text);
    } catch (e) {
      fail(res, e);
    }
  });

  // The round's memo as Markdown.
  router.get("/book-lc/round/:id/memo.md", async (req, res) => {
    try {
      const ctx = ctxOf(req, res);
      requireBookLc(ctx.auth, "view");
      const r = await loadRound(req.params.id);
      const book = await loadBook(r.bookId);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`${book.code}_memo-${r.memoNo}.md`)}"`);
      res.send(await roundMemoMarkdown(r));
    } catch (e) {
      fail(res, e);
    }
  });
}

/** Extra readers per kind, registered by later slices (BL-2: a released Teacher edition to the
 *  book's scoped teachers; a teacher's own report photo to its reporter). */
export type BookLcReadRule = (ctx: AppContext, file: IStoredFile) => Promise<boolean>;
const readRules: BookLcReadRule[] = [];
export function registerBookLcReadRule(r: BookLcReadRule): void {
  if (!readRules.includes(r)) readRules.push(r);
}

/** `GET /files/:id` gate for `book_lc_*` (§5.13). `view` reads every kind; `release` also reads
 *  print files; guardians never. */
export async function assertBookLcFileReadAccess(ctx: AppContext, file: IStoredFile): Promise<void> {
  const auth = ctx.auth;
  if (!auth || auth.role === "GUARDIAN") throw new ForbiddenError("অনুমতি নেই");
  if (canBookLc(auth, "view")) return;
  if (file.kind === "book_lc_print" && canBookLc(auth, "release")) return;
  for (const r of readRules) if (await r(ctx, file)) return;
  throw new ForbiddenError("অনুমতি নেই");
}

// BL-2 (§7.3): a reader opens the released Teacher edition; a reporter their own page photo.
registerBookLcReadRule(async (ctx, file) => !!ctx.auth && teacherMayRead(ctx.auth, file));
