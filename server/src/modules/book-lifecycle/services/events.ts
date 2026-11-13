/**
 * Lifecycle rows of the editorial log (BookEvent, D-#411 extended, §5.14) and the main-plane
 * Audit (§18). `BookEvent` holds the "why"; the main `Audit` holds who/what/which book/version —
 * NEVER book text (bookLcEvents test asserts by marker strings).
 */
import { Types } from "mongoose";
import { BookEvent, type BookEventKind, type IBookEvent } from "../../support-book/models/BookEvent";
import { dhakaDayKey } from "../../../lib/dhakaDay";

export async function lcEvent(p: {
  bookId: Types.ObjectId | string;
  kind: BookEventKind;
  actorId: Types.ObjectId | string;
  summary: string;
  reason?: string;
  origin?: "app" | "claude";
  refs?: IBookEvent["refs"];
}): Promise<void> {
  try {
    await BookEvent.create({
      bookId: String(p.bookId),
      kind: p.kind,
      flow: "LIFECYCLE",
      origin: p.origin ?? "app",
      actorId: new Types.ObjectId(String(p.actorId)),
      at: new Date(),
      summary: p.summary.slice(0, 300),
      reason: p.reason?.slice(0, 1000),
      refs: p.refs,
    });
  } catch (err) {
    console.error("[BookLcEvent] failed to append:", err);
  }
}

export type ContentSurface = "app" | "mcp" | "bundle" | "packet";

/** One CONTENT_READ per (user, version, surface) per Dhaka day — the unique dedupeKey makes a
 *  repeat a silent no-op, so a read storm writes one row. */
export async function recordContentRead(p: {
  bookId: Types.ObjectId;
  versionId: Types.ObjectId;
  userId: Types.ObjectId | string;
  surface: ContentSurface;
  what?: string;
}): Promise<void> {
  const day = dhakaDayKey(new Date());
  const dedupeKey = `CR:${String(p.userId)}:${String(p.versionId)}:${p.surface}:${day}`;
  try {
    await BookEvent.updateOne(
      { dedupeKey },
      {
        $setOnInsert: {
          bookId: String(p.bookId),
          kind: "CONTENT_READ",
          flow: "LIFECYCLE",
          origin: p.surface === "mcp" ? "claude" : "app",
          actorId: new Types.ObjectId(String(p.userId)),
          at: new Date(),
          summary: `content read (${p.surface}${p.what ? `: ${p.what}` : ""})`,
          refs: { versionId: p.versionId },
          dedupeKey,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) console.error("[BookLcEvent] content read:", err);
  }
}
