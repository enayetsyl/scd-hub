/**
 * Slot-workspace resolvers (SB-2, D-#409/#417/#419) — what the illustrator works from.
 *
 * Same gate boundary rules as `supportBook.ts`: `BookImageService` carries no
 * permission checks, so every field here declares its `book:*` scope and checks the
 * book plane before touching it.
 *
 * ONE DOCTRINE RULE IS ENFORCED BY OMISSION: `compliance_note` is never exposed. The
 * white compliance stripe is applied programmatically AFTER generation and must never
 * enter a prompt (README §5) — telling an illustrator where the stripe will land is
 * the surest way to get one drawn into the artwork. The field stays in the slot data
 * for the reviewer and the strip tooling; it does not travel to this surface.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { SupportBookLesson } from "../models/SupportBookLesson";
import { chainStates, bookStaleness, slotHistory } from "../services/BookImageService";
import { isBookDbReady } from "../../../bookDb";

function assertBookPlane(): void {
  if (!isBookDbReady()) {
    throw new ForbiddenError("বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
  }
}

interface SlotShape {
  bookId: string; lessonNo: number; slotId: string;
  sceneDescription: string | null; imageClass: string | null; action: string | null;
  containsLivingBeing: boolean | null; aspect: string | null; refs: string[];
  prompt: string | null; slotStatus: string | null;
  approved: string; cropped: string; upscaled: string; compliant: string;
  hasStale: boolean;
}

const SlotRef = builder.objectRef<SlotShape>("SupportBookSlot");
SlotRef.implement({
  description:
    "One image slot as the illustrator sees it, with its lineage state per stage. " +
    "`compliance_note` is deliberately absent — stripe language must never reach a prompt (README §5).",
  fields: (t) => ({
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    slotId: t.exposeString("slotId"),
    sceneDescription: t.exposeString("sceneDescription", { nullable: true }),
    imageClass: t.exposeString("imageClass", { nullable: true }),
    action: t.exposeString("action", { nullable: true }),
    containsLivingBeing: t.exposeBoolean("containsLivingBeing", { nullable: true }),
    aspect: t.exposeString("aspect", { nullable: true }),
    refs: t.exposeStringList("refs"),
    prompt: t.exposeString("prompt", { nullable: true }),
    slotStatus: t.exposeString("slotStatus", { nullable: true }),
    approved: t.exposeString("approved"),
    cropped: t.exposeString("cropped"),
    upscaled: t.exposeString("upscaled"),
    compliant: t.exposeString("compliant"),
    hasStale: t.exposeBoolean("hasStale"),
  }),
});

interface StaleEntryShape { slotId: string; lessonNo: number; stage: string }
const StaleEntryRef = builder.objectRef<StaleEntryShape>("SupportBookStaleArtifact");
StaleEntryRef.implement({
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    lessonNo: t.exposeInt("lessonNo"),
    stage: t.exposeString("stage"),
  }),
});

interface StaleReportShape { blocksAssembly: boolean; stale: StaleEntryShape[] }
const StaleReportRef = builder.objectRef<StaleReportShape>("SupportBookStaleReport");
StaleReportRef.implement({
  description:
    "Every stale artifact in a book — the SB-4 build gate's input (D-#417). Named by " +
    "FILE, not by stage, because a re-approved image whose compliant version was never " +
    "regenerated still builds a valid PDF; it just prints the old picture.",
  fields: (t) => ({
    blocksAssembly: t.exposeBoolean("blocksAssembly"),
    stale: t.field({ type: [StaleEntryRef], resolve: (r) => r.stale }),
  }),
});

interface AssetShape {
  assetId: string; stage: string; fileId: string; source: string | null;
  generatorTool: string | null; current: boolean; uploadedAt: Date; uploadedBy: string;
}
const AssetRef = builder.objectRef<AssetShape>("SupportBookImageAsset");
AssetRef.implement({
  description:
    "One artifact in a slot's history. A re-upload SUPERSEDES rather than overwrites, " +
    "so a rejected image stays readable — it is evidence (D-#409).",
  fields: (t) => ({
    assetId: t.exposeString("assetId"),
    stage: t.exposeString("stage"),
    fileId: t.exposeString("fileId"),
    source: t.exposeString("source", { nullable: true }),
    generatorTool: t.exposeString("generatorTool", { nullable: true }),
    current: t.exposeBoolean("current"),
    uploadedAt: t.string({ resolve: (a) => a.uploadedAt.toISOString() }),
    uploadedBy: t.exposeString("uploadedBy"),
  }),
});

builder.queryField("supportBookSlots", (t) =>
  t.field({
    type: [SlotRef],
    description:
      "The illustrator's queue: every image slot in a book (or one পাঠ) with its prompt, " +
      "refs and per-stage lineage. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), lessonNo: t.arg.int({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = { bookId: args.bookId };
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      const lessons = await SupportBookLesson.find(q).sort({ lessonNo: 1 }).lean();
      const out: SlotShape[] = [];
      for (const l of lessons) {
        for (const raw of l.imageSlots ?? []) {
          const s = raw as Record<string, unknown>;
          const slotId = typeof s.id === "string" ? s.id : null;
          if (!slotId) continue;
          const states = await chainStates(args.bookId, slotId);
          out.push({
            bookId: l.bookId,
            lessonNo: l.lessonNo,
            slotId,
            sceneDescription: typeof s.scene_description === "string" ? s.scene_description : null,
            imageClass: typeof s.image_class === "string" ? s.image_class : null,
            action: typeof s.action === "string" ? s.action : null,
            containsLivingBeing:
              typeof s.contains_living_being === "boolean" ? s.contains_living_being : null,
            aspect: typeof s.aspect === "string" ? s.aspect : null,
            refs: Array.isArray(s.refs) ? (s.refs as string[]) : [],
            prompt: typeof s.prompt === "string" ? s.prompt : null,
            slotStatus: typeof s.status === "string" ? s.status : null,
            // compliance_note is NOT read — see the module header.
            approved: states.APPROVED,
            cropped: states.CROPPED,
            upscaled: states.UPSCALED,
            compliant: states.COMPLIANT,
            hasStale: Object.values(states).includes("STALE"),
          });
        }
      }
      return out;
    },
  }),
);

builder.queryField("supportBookStaleness", (t) =>
  t.field({
    type: StaleReportRef,
    description: "Every stale artifact in a book. Any STALE anywhere locks assembly (D-#417). Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const r = await bookStaleness(args.bookId);
      return { blocksAssembly: r.blocksAssembly, stale: r.stale.map((x) => ({ ...x, stage: String(x.stage) })) };
    },
  }),
);

builder.queryField("supportBookSlotHistory", (t) =>
  t.field({
    type: [AssetRef],
    description:
      "Every artifact ever registered for one slot, newest first — including superseded " +
      "ones, which is the point (D-#409). Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), slotId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const rows = await slotHistory(args.bookId, args.slotId);
      return rows.map((a) => ({
        assetId: String(a._id),
        stage: a.stage,
        fileId: String(a.storedFileId),
        source: a.source ?? null,
        generatorTool: a.generatorTool ?? null,
        current: a.current,
        uploadedAt: a.uploadedAt,
        uploadedBy: String(a.uploadedBy),
      }));
    },
  }),
);
