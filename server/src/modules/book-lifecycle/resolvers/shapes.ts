/**
 * Small GraphQL object types shared by the book-lifecycle resolvers (plain value shapes, no ids of
 * people, no Drive ids — files are referenced by StoredFile id and read through GET /files/:id).
 */
import { builder } from "../../../schema";

interface HistoryFile { fileId: string; label: string }
interface FileRow { role: string; edition: string | null; format: string; fileId: string; stale: boolean; at: string }
interface ChapterRow { key: string; title: string; order: number; chars: number; sha: string }
interface ChangeRow { chapterKey: string; where: string; page: string | null; beforeExcerpt: string; afterExcerpt: string; reason: string; refs: string[]; route: string; sacred: boolean }
interface StatusRow { status: string; at: string; note: string | null; byName: string | null }
interface Wording { code: string; textBn: string }
interface PageMapRow { chapterKey: string; title: string; startPage: number | null; confirmed: boolean }
interface MarkRow { targetId: string; value: string | null; noteBn: string | null; scanFileId: string | null; scanPage: number | null; via: string; checkedAt: string | null; checkedByName: string | null }
interface OptionRow { key: string; textBn: string }
interface Finding { code: string; level: string; messageBn: string }
interface Unexplained { index: number; beforeText: string; afterText: string; runHash: string | null; acked: boolean }
interface DraftChapterRow { key: string; newSha: string | null; title: string; status: string; mode: string | null; isNew: boolean; removed: boolean; opsCount: number; findings: Finding[]; unexplained: Unexplained[]; notApplied: Wording[] }
interface Word { op: string; text: string }
interface Hunk { aStart: number; aLines: number; bStart: number; bLines: number; words: Word[] }
interface DiffChapter { key: string; title: string; status: string; hunks: Hunk[] }

const HistoryFileRef = builder.objectRef<HistoryFile>("BookLcHistoryFile").implement({
  fields: (t) => ({ fileId: t.exposeString("fileId"), label: t.exposeString("label") }),
});
const FileRef = builder.objectRef<FileRow>("BookLcFile").implement({
  description: "A file on a version; `stale` = made from an older master text (§5.2.2).",
  fields: (t) => ({
    role: t.exposeString("role"),
    edition: t.exposeString("edition", { nullable: true }),
    format: t.exposeString("format"),
    fileId: t.exposeString("fileId"),
    stale: t.exposeBoolean("stale"),
    at: t.exposeString("at"),
  }),
});
const ChapterRef = builder.objectRef<ChapterRow>("BookLcChapter").implement({
  fields: (t) => ({ key: t.exposeString("key"), title: t.exposeString("title"), order: t.exposeInt("order"), chars: t.exposeInt("chars"), sha: t.exposeString("sha") }),
});
const ChangeRef = builder.objectRef<ChangeRow>("BookLcChange").implement({
  description: "One row of the change list (§5.2.1) — the memo's Part 1.",
  fields: (t) => ({
    chapterKey: t.exposeString("chapterKey"),
    where: t.exposeString("where"),
    page: t.exposeString("page", { nullable: true }),
    beforeExcerpt: t.exposeString("beforeExcerpt"),
    afterExcerpt: t.exposeString("afterExcerpt"),
    reason: t.exposeString("reason"),
    refs: t.exposeStringList("refs"),
    route: t.exposeString("route"),
    sacred: t.exposeBoolean("sacred"),
  }),
});
const StatusRowRef = builder.objectRef<StatusRow>("BookLcStatusRow").implement({
  fields: (t) => ({ status: t.exposeString("status"), at: t.exposeString("at"), note: t.exposeString("note", { nullable: true }), byName: t.exposeString("byName", { nullable: true }) }),
});
const WordingRef = builder.objectRef<Wording>("BookLcCodeText").implement({
  fields: (t) => ({ code: t.exposeString("code"), textBn: t.exposeString("textBn") }),
});
const PageMapRef = builder.objectRef<PageMapRow>("BookLcPageMapRow").implement({
  fields: (t) => ({ chapterKey: t.exposeString("chapterKey"), title: t.exposeString("title"), startPage: t.exposeInt("startPage", { nullable: true }), confirmed: t.exposeBoolean("confirmed") }),
});
const MarkRef = builder.objectRef<MarkRow>("BookLcMark").implement({
  description: "Her mark on an item (value = agree|disagree|modify) or a decision (value = option key; null = পরে), from the scan.",
  fields: (t) => ({
    targetId: t.exposeString("targetId"),
    value: t.exposeString("value", { nullable: true }),
    noteBn: t.exposeString("noteBn", { nullable: true }),
    scanFileId: t.exposeString("scanFileId", { nullable: true }),
    scanPage: t.exposeInt("scanPage", { nullable: true }),
    via: t.exposeString("via"),
    checkedAt: t.exposeString("checkedAt", { nullable: true }),
    checkedByName: t.exposeString("checkedByName", { nullable: true }),
  }),
});
const OptionRef = builder.objectRef<OptionRow>("BookLcOption").implement({
  fields: (t) => ({ key: t.exposeString("key"), textBn: t.exposeString("textBn") }),
});
const FindingRef = builder.objectRef<Finding>("BookLcFinding").implement({
  fields: (t) => ({ code: t.exposeString("code"), level: t.exposeString("level"), messageBn: t.exposeString("messageBn") }),
});
const UnexplainedRef = builder.objectRef<Unexplained>("BookLcUnexplained").implement({
  fields: (t) => ({ index: t.exposeInt("index"), beforeText: t.exposeString("beforeText"), afterText: t.exposeString("afterText"), runHash: t.exposeString("runHash", { nullable: true }), acked: t.exposeBoolean("acked") }),
});
const DraftChapterRef = builder.objectRef<DraftChapterRow>("BookLcDraftChapter").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    newSha: t.exposeString("newSha", { nullable: true }),
    title: t.exposeString("title"),
    status: t.exposeString("status"),
    mode: t.exposeString("mode", { nullable: true }),
    isNew: t.exposeBoolean("isNew"),
    removed: t.exposeBoolean("removed"),
    opsCount: t.exposeInt("opsCount"),
    findings: t.field({ type: [FindingRef], resolve: (c) => c.findings }),
    unexplained: t.field({ type: [UnexplainedRef], resolve: (c) => c.unexplained }),
    notApplied: t.field({ type: [WordingRef], resolve: (c) => c.notApplied }),
  }),
});
const WordRef = builder.objectRef<Word>("BookLcDiffWord").implement({
  fields: (t) => ({ op: t.exposeString("op"), text: t.exposeString("text") }),
});
const HunkRef = builder.objectRef<Hunk>("BookLcDiffHunk").implement({
  fields: (t) => ({
    aStart: t.exposeInt("aStart"),
    aLines: t.exposeInt("aLines"),
    bStart: t.exposeInt("bStart"),
    bLines: t.exposeInt("bLines"),
    words: t.field({ type: [WordRef], resolve: (h) => h.words }),
  }),
});
const DiffChapterRef = builder.objectRef<DiffChapter>("BookLcDiffChapter").implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    title: t.exposeString("title"),
    status: t.exposeString("status"),
    hunks: t.field({ type: [HunkRef], resolve: (c) => c.hunks }),
  }),
});

export const BOBC = { HistoryFileRef, FileRef, ChapterRef, ChangeRef, StatusRowRef, WordingRef, PageMapRef, MarkRef, OptionRef, FindingRef, DraftChapterRef, DiffChapterRef };
