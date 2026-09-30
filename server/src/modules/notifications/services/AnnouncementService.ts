/**
 * The guardian announcement read (D-#700).
 *
 * One query, called on every app open by every guardian, so it is deliberately
 * the cheapest thing that can answer: one indexed findOne, no joins, no identity
 * lookups. It must also never throw — the popup mounts inside the authenticated
 * shell, and an error there would break the whole app for a parent who came in
 * to check homework. Same fail-soft posture as the drawer badge (791e5fe).
 */
import { GuardianAnnouncement } from "../models/GuardianAnnouncement";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import type { AppContext } from "../../../context";

export interface AnnouncementShape {
  id: string;
  titleBn: string;
  bodyBn: string;
  ctaBn: string;
  deepLinkTab: string;
  /**
   * TODAY, as the SERVER reckons it in Asia/Dhaka.
   *
   * The client stores "which day did I last show this" and compares it to this
   * key rather than to a date it computes itself. Two reasons: a device with a
   * wrong clock or a traveller's timezone would otherwise get a different idea
   * of "today" than the school has, and the client would need its own Dhaka
   * conversion — a second implementation of the school day, which is exactly
   * how the two drift.
   */
  todayKey: string;
}

/**
 * The live announcement for this guardian today, or null.
 *
 * Guardian-only by design: staff have the board itself and do not need to be
 * interrupted. Returns null rather than throwing for every other caller, so the
 * shell never has to special-case who is signed in.
 */
export async function myAnnouncement(ctx: AppContext): Promise<AnnouncementShape | null> {
  if (!ctx.auth || ctx.auth.role !== "GUARDIAN") return null;

  const today = dhakaDayKey(new Date());

  try {
    // Inclusive on both ends: an announcement whose window is a single day shows
    // on that day. String comparison is exact for zero-padded ISO keys.
    const row = await GuardianAnnouncement.findOne({
      audience: "GUARDIAN",
      active: true,
      startsOn: { $lte: today },
      endsOn: { $gte: today },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!row) return null;

    const a = row as unknown as {
      _id: { toString(): string };
      titleBn: string;
      bodyBn: string;
      ctaBn?: string;
      deepLinkTab?: string;
    };
    return {
      id: a._id.toString(),
      titleBn: a.titleBn,
      bodyBn: a.bodyBn,
      ctaBn: a.ctaBn ?? "",
      deepLinkTab: a.deepLinkTab ?? "",
      todayKey: today,
    };
  } catch (err) {
    // A read failure must not take down the shell the popup mounts in.
    console.error("myAnnouncement read failed — showing nothing:", err);
    return null;
  }
}
