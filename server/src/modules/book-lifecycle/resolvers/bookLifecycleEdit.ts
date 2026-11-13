/**
 * Book-lifecycle GraphQL, BL-3 (docs/prd-book-lifecycle.md §12, §15.4; S11/S12): the edit-draft
 * pipeline's person-facing doors — submit (validator report), the VR-7 "আমি দেখেছি" tick, bundle
 * result uploads (JSON text or a whole master + changes) and the transcription-pack upload. The zips
 * themselves download over REST (`/files/book-lc/bundle`, `/files/book-lc/transcription-pack`).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { assertBookPlane } from "../services/access";
import * as D from "../services/draftService";
import * as B from "../services/bundle";

const auth = (ctx: AppContext) => {
  assertBookPlane();
  return ctx.auth!;
};

interface SubmitShape {
  status: string;
  blocking: { code: string; level: string; messageBn: string }[];
  warnings: { code: string; level: string; messageBn: string }[];
}
const FindingOut = builder.objectRef<{ code: string; level: string; messageBn: string }>("BookLcSubmitFinding").implement({
  fields: (t) => ({ code: t.exposeString("code"), level: t.exposeString("level"), messageBn: t.exposeString("messageBn") }),
});
const SubmitRef = builder.objectRef<SubmitShape>("BookLcSubmitResult").implement({
  description: "submit never creates a version (VR-15): ready | refused, with the validator report.",
  fields: (t) => ({
    status: t.exposeString("status"),
    blocking: t.field({ type: [FindingOut], resolve: (s) => s.blocking }),
    warnings: t.field({ type: [FindingOut], resolve: (s) => s.warnings }),
  }),
});

interface UploadShape {
  draftId: string;
  chapters: { key: string; status: string; blocking: number; unexplained: number }[];
}
const UploadChapterRef = builder.objectRef<UploadShape["chapters"][number]>("BookLcUploadChapter").implement({
  fields: (t) => ({ key: t.exposeString("key"), status: t.exposeString("status"), blocking: t.exposeInt("blocking"), unexplained: t.exposeInt("unexplained") }),
});
const UploadRef = builder.objectRef<UploadShape>("BookLcBundleUpload").implement({
  fields: (t) => ({ draftId: t.exposeString("draftId"), chapters: t.field({ type: [UploadChapterRef], resolve: (s) => s.chapters }) }),
});

builder.mutationField("submitBookLcDraft", (t) =>
  t.field({
    type: SubmitRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    args: { draftId: t.arg.string({ required: true }), summaryBn: t.arg.string(), bump: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return D.submitDraft(auth(ctx), a.draftId, { summaryBn: a.summaryBn, bump: a.bump === "major" ? "major" : a.bump === "minor" ? "minor" : null });
    },
  }),
);

builder.mutationField("ackBookLcUnexplained", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "book_lifecycle:finalize" },
    description: "VR-7 — the Principal has looked at an unexplained hunk (আমি দেখেছি), stamped.",
    args: { draftId: t.arg.string({ required: true }), chapterKey: t.arg.string({ required: true }), index: t.arg.int({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      await D.ackUnexplained(auth(ctx), a.draftId, a.chapterKey, a.index);
      return true;
    },
  }),
);

builder.mutationField("uploadBookLcBundleResult", (t) =>
  t.field({
    type: UploadRef,
    authScopes: { hasPermission: "book_lifecycle:manage" },
    description: "A book-edit-result/v1 answer (raw JSON, or the first fenced block of a .md / .txt), ≤ 4 MB.",
    args: { bookId: t.arg.string({ required: true }), text: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      const r = await B.uploadBundleResult(auth(ctx), a.bookId, a.text);
      return { draftId: r.draftId, chapters: r.chapters.map((c) => ({ ...c, unexplained: 0 })) };
    },
  }),
);

builder.mutationField("uploadBookLcTranscription", (t) =>
  t.field({
    type: [builder.objectRef<{ code: string }>("BookLcCreatedCode").implement({ fields: (tt) => ({ code: tt.exposeString("code") }) })],
    authScopes: { hasPermission: "book_lifecycle:manage" },
    description: "A book-feedback-items/v1 answer for a round: the rows arrive UNCHECKED; never a verdict.",
    args: { roundId: t.arg.string({ required: true }), text: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      assertBookPlane();
      return (await B.uploadTranscriptionResult(auth(ctx), a.roundId, a.text)).created.map((code) => ({ code }));
    },
  }),
);
