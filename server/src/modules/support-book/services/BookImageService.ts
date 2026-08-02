/**
 * BookImageService — the slot image chain and its staleness (SB-2, D-#409/#417/#419).
 *
 * THE IDEA, adopted from the storybook workbench where it is proven over five books:
 * each stage records a fingerprint of the artifact it was DERIVED FROM. Re-approve an
 * image and every downstream row's recorded input stops matching reality — and that
 * disagreement IS the staleness. Nothing has to remember to invalidate anything,
 * which is the only version of this that survives a busy week.
 *
 * WHY IT EARNS ITS KEEP: a re-approved image whose compliant version was never
 * regenerated still builds a perfectly valid PDF. It just prints the old picture.
 * With one person and one book that is a mistake you catch; with 201 slots across 54
 * lessons and five people it is the default outcome. So **any STALE artifact anywhere
 * locks assembly** (SB-4), and the report names FILES rather than stages — "three
 * files are stale" is actionable, "the crop stage is stale" is not.
 *
 * The chain is APPROVED → CROPPED → UPSCALED → COMPLIANT. `book.json` names the
 * COMPLIANT filename, so a stale COMPLIANT is exactly what would reach print.
 */
import type { Types } from "mongoose";
import { ARTIFACT_STAGES, type ArtifactStage, type ImageSource, type LineageState } from "@scd/shared";
import { BookImageAsset, type IBookImageAsset } from "../models/BookImageAsset";
import { writeBookEvent } from "../models/BookEvent";

/** Downstream-first is never useful here; every read walks the chain in order. */
const CHAIN: ArtifactStage[] = [...ARTIFACT_STAGES];

/** The stage a given stage is derived from, or null for the head of the chain. */
export function upstreamOf(stage: ArtifactStage): ArtifactStage | null {
  const i = CHAIN.indexOf(stage);
  return i <= 0 ? null : CHAIN[i - 1];
}

/**
 * A file's identity for lineage purposes.
 *
 * The StoredFile id IS the fingerprint: every upload creates a new StoredFile row, so
 * a replaced artifact necessarily has a new id. Hashing bytes would be stronger but
 * would mean pulling every image back out of Drive on every staleness read — a lot of
 * egress to detect something the id already tells us.
 */
export function fingerprintOf(storedFileId: Types.ObjectId | string): string {
  return String(storedFileId);
}

export interface RegisterAssetInput {
  bookId: string;
  lessonNo: number;
  slotId: string;
  stage: ArtifactStage;
  storedFileId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  /** APPROVED rows only — which path the artwork came by (D-#419). */
  source?: ImageSource;
  generatorTool?: string;
  generatorNote?: string;
  promptSha256?: string;
}

/** The current artifact at one stage of one slot, or null. */
export async function currentAt(
  bookId: string,
  slotId: string,
  stage: ArtifactStage,
): Promise<IBookImageAsset | null> {
  return BookImageAsset.findOne({ bookId, slotId, stage, current: true }).lean<IBookImageAsset>();
}

/**
 * Register a new artifact at a stage. SUPERSEDES the previous current row rather than
 * overwriting it — an image a reviewer rejected is evidence, and the timeline has to
 * be able to show what was replaced.
 */
export async function registerAsset(input: RegisterAssetInput): Promise<IBookImageAsset> {
  const upstream = upstreamOf(input.stage);
  const upstreamRow = upstream ? await currentAt(input.bookId, input.slotId, upstream) : null;

  const prior = await BookImageAsset.findOne({
    bookId: input.bookId, slotId: input.slotId, stage: input.stage, current: true,
  });

  if (prior) {
    await BookImageAsset.updateOne({ _id: prior._id }, { $set: { current: false } });
  }

  const created = await BookImageAsset.create({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    slotId: input.slotId,
    stage: input.stage,
    storedFileId: input.storedFileId,
    source: input.source,
    generatorTool: input.generatorTool,
    generatorNote: input.generatorNote,
    promptSha256: input.promptSha256,
    fingerprint: fingerprintOf(input.storedFileId),
    // Null at the head of the chain; otherwise what this was derived from RIGHT NOW.
    inputFingerprint: upstreamRow ? upstreamRow.fingerprint : null,
    current: true,
    supersedes: prior?._id,
    uploadedBy: input.uploadedBy,
    uploadedAt: new Date(),
  });

  await writeBookEvent({
    bookId: input.bookId,
    lessonNo: input.lessonNo,
    targetType: "IMAGE_SLOT",
    targetId: input.slotId,
    kind: prior ? "IMAGE_SUPERSEDED" : "IMAGE_UPLOADED",
    actorId: input.uploadedBy,
    summary: prior
      ? `${input.slotId} ${input.stage} replaced${input.source ? ` (${input.source})` : ""}`
      : `${input.slotId} ${input.stage} added${input.source ? ` (${input.source})` : ""}`,
    refs: { assetId: created._id },
  });

  // Re-registering upstream is what makes everything below it stale. Say so at the
  // moment it happens rather than leaving it to be discovered at build time.
  if (prior) {
    const downstream = await staleBelow(input.bookId, input.slotId, input.stage);
    if (downstream.length) {
      await writeBookEvent({
        bookId: input.bookId,
        lessonNo: input.lessonNo,
        targetType: "IMAGE_SLOT",
        targetId: input.slotId,
        kind: "LINEAGE_STALE",
        actorId: input.uploadedBy,
        summary: `${input.slotId}: ${downstream.join(", ")} now stale — re-run before assembly`,
      });
    }
  }

  return created;
}

/** The stages below `stage` that now hold a stale artifact. */
async function staleBelow(bookId: string, slotId: string, stage: ArtifactStage): Promise<ArtifactStage[]> {
  const states = await chainStates(bookId, slotId);
  return CHAIN.slice(CHAIN.indexOf(stage) + 1).filter((s) => states[s] === "STALE");
}

/**
 * The lineage state of every stage of one slot, computed in ONE walk down the chain.
 *
 *   MISSING — nothing at this stage yet.
 *   STALE   — derived from a version of its input that is no longer current, OR its
 *             input has vanished, OR **anything upstream of it is stale**.
 *   FRESH   — derived from exactly what is upstream now, all the way to the head.
 *
 * THE CASCADE IS THE POINT, and it is not obvious. Comparing each stage only to its
 * direct input is not enough: re-approve an image and CROPPED goes stale, but
 * UPSCALED still matches the cropped FILE (which did not change — only its standing
 * did), so a per-stage check reports UPSCALED and COMPLIANT as fresh. The stale
 * picture then sails through to print, which is the exact failure D-#417 exists to
 * stop. Staleness has to travel the whole way down.
 */
export async function chainStates(
  bookId: string,
  slotId: string,
): Promise<Record<ArtifactStage, LineageState>> {
  const rows = {} as Record<ArtifactStage, IBookImageAsset | null>;
  for (const s of CHAIN) rows[s] = await currentAt(bookId, slotId, s);

  const states = {} as Record<ArtifactStage, LineageState>;
  let upstreamStale = false;

  for (const stage of CHAIN) {
    const row = rows[stage];
    if (!row) {
      // Nothing here yet. A gap does NOT make the stages below it stale — they are
      // simply not built either; only a stage that EXISTS can be out of date.
      states[stage] = "MISSING";
      continue;
    }
    const upstream = upstreamOf(stage);
    if (!upstream) {
      states[stage] = "FRESH"; // head of the chain — derived from nothing
    } else if (!rows[upstream]) {
      // Derived from something the book no longer has.
      states[stage] = "STALE";
    } else if (row.inputFingerprint !== rows[upstream]!.fingerprint) {
      states[stage] = "STALE";
    } else {
      states[stage] = upstreamStale ? "STALE" : "FRESH";
    }
    if (states[stage] === "STALE") upstreamStale = true;
  }
  return states;
}

/** The lineage state of one stage. Thin read over `chainStates` — the cascade means a
 *  single stage can never be judged in isolation. */
export async function stageState(
  bookId: string,
  slotId: string,
  stage: ArtifactStage,
): Promise<LineageState> {
  return (await chainStates(bookId, slotId))[stage];
}

export interface SlotLineage {
  slotId: string;
  lessonNo: number;
  stages: Record<ArtifactStage, LineageState>;
  /** True when any stage of this slot is stale. */
  hasStale: boolean;
}

export async function slotLineage(bookId: string, slotId: string): Promise<SlotLineage | null> {
  const any = await BookImageAsset.findOne({ bookId, slotId }).lean<IBookImageAsset>();
  if (!any) return null;
  const stages = await chainStates(bookId, slotId);
  return {
    slotId,
    lessonNo: any.lessonNo,
    stages,
    hasStale: CHAIN.some((s) => stages[s] === "STALE"),
  };
}

export interface StaleReport {
  /** One entry per stale artifact, named by FILE not by stage — "L012-img-03
   *  COMPLIANT" is something a person can act on. */
  stale: Array<{ slotId: string; lessonNo: number; stage: ArtifactStage }>;
  /** True when assembly must refuse (D-#417). */
  blocksAssembly: boolean;
}

/** Every stale artifact in a book. This is the SB-4 build gate's input. */
export async function bookStaleness(bookId: string): Promise<StaleReport> {
  const slots = await BookImageAsset.distinct("slotId", { bookId });
  const stale: StaleReport["stale"] = [];
  for (const slotId of slots as string[]) {
    const lin = await slotLineage(bookId, slotId);
    if (!lin) continue;
    for (const s of CHAIN) {
      if (lin.stages[s] === "STALE") stale.push({ slotId, lessonNo: lin.lessonNo, stage: s });
    }
  }
  return { stale, blocksAssembly: stale.length > 0 };
}

/** The full history for one slot, newest first — what the timeline renders. */
export async function slotHistory(bookId: string, slotId: string): Promise<IBookImageAsset[]> {
  return BookImageAsset.find({ bookId, slotId }).sort({ uploadedAt: -1 }).lean<IBookImageAsset[]>();
}
