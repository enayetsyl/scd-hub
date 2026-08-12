/**
 * GuardianEngagementService (GE-1/GE-3, D-#464/#465) — the Principal's read on whether
 * families are actually using the portal, and on what.
 *
 * Three independent signals, deliberately kept separate in the payload because they
 * fail in different ways and a single blended "engagement score" would hide which one
 * is broken:
 *
 *   1. LOGIN   — `audits` LOGIN_SUCCESS rows with actorRole GUARDIAN. The only signal
 *                that predates this module, so it has real history behind it.
 *   2. VIEWS   — `guardianviews` (GE-2). Starts empty and is only meaningful for days
 *                AFTER the instrumentation shipped; `viewsSince` states that date so
 *                the screen never presents a pre-launch zero as disengagement.
 *   3. INBOX   — `notifications` delivered-vs-read for guardian recipients.
 *
 * IDENTITY PLANE. This joins guardians to students by design and therefore must never
 * move into `modules/corpus`, which the ADR-005 fail-closed firewall test forbids from
 * importing any identity model. Nothing here is exported to the analytics plane.
 *
 * Gated by `audit:read` at the resolver — Principal-only, reusing the existing lever
 * rather than minting a permission (the D-#414 precedent).
 */
import { Types } from "mongoose";
import { GUARDIAN_VIEW_SURFACES } from "@scd/shared";
import type { GuardianEngagementBand } from "@scd/shared";
import { Guardian } from "../../foundation/models/Guardian";
import { GuardianLink } from "../../foundation/models/GuardianLink";
import { Student } from "../../foundation/models/Student";
import { Section } from "../../foundation/models/Section";
import { Audit } from "../../platform/models/Audit";
import { Notification } from "../../notifications/models/Notification";
import { GuardianView } from "../models/GuardianView";
import { dhakaDayKey } from "../../../lib/dhakaDay";

const DAY_MS = 86_400_000;
/** Distinct active days inside the window at or above which a family reads as REGULAR. */
const REGULAR_MIN_ACTIVE_DAYS = 8;
/** Days of silence after which a family that HAS used the portal reads as LAPSED. */
const LAPSED_AFTER_DAYS = 30;
export const ENGAGEMENT_WINDOW_DEFAULT = 90;
export const ENGAGEMENT_WINDOW_MAX = 365;

export interface EngagementSummary {
  /** DESIGNATED portal guardians — those holding an active link to a current student.
   *  NOT every guardian record; see the D-#474 note on the query for why. */
  totalGuardians: number;
  loginEnabled: number;
  /** Designated guardians with no login issued: an onboarding gap, not a chase target. */
  contactOnly: number;
  everLoggedIn: number;
  neverLoggedIn: number;
  // --- student-level reachability (D-#474) ---------------------------------
  /** Active students with at least one designated guardian. */
  studentsTotal: number;
  /** ...whose family has signed in at least once — the figure that actually matters. */
  studentsReachable: number;
  /** ...that no guardian has ever signed in for. */
  studentsUnreachable: number;
  /** ...where no designated guardian even holds a login (credential gap, not a chase). */
  studentsNoCredentials: number;
  /** Guardian records EXCLUDED as non-designated (the other parent). Reported so the
   *  exclusion is visible rather than a silent filter. */
  excludedNonDesignated: number;
  /** Of those, how many could still log in and would see an EMPTY portal — a real
   *  support trap, surfaced here because nothing else in the app reports it. */
  excludedButLoginEnabled: number;
  active7: number;
  active30: number;
  active90: number;
  regular: number;
  occasional: number;
  lapsed: number;
  /** Guardian-addressed inbox rows in the window, and how many were opened. */
  notificationsDelivered: number;
  notificationsRead: number;
  /** Total view rows recorded in the window (0 before GE-2 shipped — see viewsSince). */
  viewsRecorded: number;
  /** Earliest view row we hold, ISO. Null = no view data yet; the screen must say so. */
  viewsSince: string | null;
  windowDays: number;
}

export interface EngagementGuardianRow {
  guardianId: string;
  name: string;
  phone: string | null;
  loginEnabled: boolean;
  childNames: string[];
  sectionNames: string[];
  band: GuardianEngagementBand;
  lastLoginAt: string | null;
  loginCount: number;
  /** Distinct Dhaka days with a login inside the window — the regularity measure. */
  activeDays: number;
  notificationsDelivered: number;
  notificationsRead: number;
  viewCount: number;
  lastViewAt: string | null;
  /** Surfaces this family has actually opened, most-used first. */
  topSurfaces: string[];
}

export interface SurfaceUsage {
  surface: string;
  /** Opens (sum of the per-day collapsed counts), not row count. */
  views: number;
  distinctGuardians: number;
  lastAt: string | null;
}

export interface InboxKindStat {
  kind: string;
  delivered: number;
  read: number;
}

export interface GuardianEngagementReport {
  summary: EngagementSummary;
  guardians: EngagementGuardianRow[];
  surfaces: SurfaceUsage[];
  inboxByKind: InboxKindStat[];
  generatedAt: string;
}

export interface GuardianEngagementInput {
  days?: number | null;
  /** Filter to one section — lets a class teacher be handed only their own families. */
  sectionId?: string | null;
  band?: string | null;
}

function bandOf(
  activeDays: number,
  lastLoginAt: Date | null,
  loginEnabled: boolean,
  now: number,
): GuardianEngagementBand {
  // NO_LOGIN outranks everything (D-#474). A family nobody issued a password to cannot
  // be "chased" — the action is to issue credentials — so it must never sit in NEVER.
  if (!loginEnabled) return "NO_LOGIN";
  if (!lastLoginAt) return "NEVER";
  if (now - lastLoginAt.getTime() > LAPSED_AFTER_DAYS * DAY_MS) return "LAPSED";
  return activeDays >= REGULAR_MIN_ACTIVE_DAYS ? "REGULAR" : "OCCASIONAL";
}

export async function guardianEngagement(
  input: GuardianEngagementInput = {},
): Promise<GuardianEngagementReport> {
  const windowDays = Math.min(Math.max(input.days ?? ENGAGEMENT_WINDOW_DEFAULT, 1), ENGAGEMENT_WINDOW_MAX);
  const now = Date.now();
  const since = new Date(now - windowDays * DAY_MS);

  // --- roster: guardians, their children, their sections -------------------
  //
  // D-#474 — THE DESIGNATED-GUARDIAN RULE. A student carries 2–3 guardian records
  // (father, mother, sometimes a third), but the school issues the portal to exactly
  // ONE of them, and records that choice by leaving that guardian's GuardianLink
  // active while DEACTIVATING the others'. In the live roster that is 91 active links
  // against 120 deactivated ones.
  //
  // The first cut of this report counted every guardian record, so the other parents —
  // people who were never given the portal and never should have been chased — made up
  // 63% of the "never logged in" list and swamped the very thing the report exists to
  // produce. Reachability is a property of the DESIGNATED guardian, so that is the
  // population, and the excluded count is reported in the summary rather than filtered
  // away in silence.
  const allGuardians = await Guardian.find({ active: { $ne: false } })
    .select("name phone identifier loginEnabled")
    .lean();
  const allGuardianIds = allGuardians.map((g) => g._id);

  const links = await GuardianLink.find({ guardianId: { $in: allGuardianIds } })
    .select("guardianId studentId active")
    .lean();
  const liveLinks = links.filter((l) => l.active !== false);

  const studentIds = [...new Set(liveLinks.map((l) => l.studentId.toString()))].map(
    (s) => new Types.ObjectId(s),
  );
  const students = await Student.find({ _id: { $in: studentIds }, active: true })
    .select("name nameBn sectionId")
    .lean();
  const studentById = new Map(students.map((s) => [s._id.toString(), s]));

  // A link only designates when BOTH ends are live: an active link to an active student.
  // A link left active on a departed student does not make its guardian a current family.
  const activeLinks = liveLinks.filter((l) => studentById.has(l.studentId.toString()));
  const designatedIds = new Set(activeLinks.map((l) => l.guardianId.toString()));

  const guardians = allGuardians.filter((g) => designatedIds.has(g._id.toString()));
  const guardianIds = guardians.map((g) => g._id);
  const excluded = allGuardians.filter((g) => !designatedIds.has(g._id.toString()));

  const sectionIds = [...new Set(students.map((s) => s.sectionId?.toString()).filter(Boolean))] as string[];
  const sections = await Section.find({ _id: { $in: sectionIds } }).select("nameBn code").lean();
  const sectionById = new Map(sections.map((s) => [s._id.toString(), s]));

  const childrenByGuardian = new Map<string, string[]>();
  const sectionsByGuardian = new Map<string, Set<string>>();
  const sectionIdsByGuardian = new Map<string, Set<string>>();
  for (const l of activeLinks) {
    const st = studentById.get(l.studentId.toString());
    if (!st) continue;
    const gk = l.guardianId.toString();
    const kids = childrenByGuardian.get(gk) ?? [];
    kids.push(st.nameBn ?? st.name);
    childrenByGuardian.set(gk, kids);
    const sid = st.sectionId?.toString();
    if (sid) {
      const sec = sectionById.get(sid);
      const names = sectionsByGuardian.get(gk) ?? new Set<string>();
      if (sec) names.add(sec.nameBn || sec.code);
      sectionsByGuardian.set(gk, names);
      const ids = sectionIdsByGuardian.get(gk) ?? new Set<string>();
      ids.add(sid);
      sectionIdsByGuardian.set(gk, ids);
    }
  }

  // --- signal 1: logins ----------------------------------------------------
  // Guardian LOGIN_SUCCESS rows carry actorId = Guardian._id (AuthService), which is a
  // DIFFERENT collection from the staff User ids on other audit rows — Audit.actorId is
  // deliberately untyped. Filtering on actorRole is what keeps the two apart.
  const loginRows = await Audit.find({
    eventKind: "LOGIN_SUCCESS",
    actorRole: "GUARDIAN",
    actorId: { $in: guardianIds },
  })
    .select("actorId eventAt")
    .lean();

  // Lifetime last-login (NOT window-bounded): a family last seen 200 days ago must read
  // as LAPSED, not as NEVER. Windowing this is the easy bug that would mislabel exactly
  // the families the report exists to surface.
  const lastLoginByGuardian = new Map<string, Date>();
  const loginCountInWindow = new Map<string, number>();
  const activeDayKeysInWindow = new Map<string, Set<string>>();
  for (const r of loginRows) {
    const gk = r.actorId?.toString();
    if (!gk) continue;
    const at = new Date(r.eventAt);
    const prev = lastLoginByGuardian.get(gk);
    if (!prev || at > prev) lastLoginByGuardian.set(gk, at);
    if (at >= since) {
      loginCountInWindow.set(gk, (loginCountInWindow.get(gk) ?? 0) + 1);
      const days = activeDayKeysInWindow.get(gk) ?? new Set<string>();
      days.add(dhakaDayKey(at));
      activeDayKeysInWindow.set(gk, days);
    }
  }

  // --- signal 2: views -----------------------------------------------------
  const viewRows = await GuardianView.find({ lastAt: { $gte: since } })
    .select("guardianId surface count lastAt")
    .lean();
  const oldestView = await GuardianView.findOne().sort({ firstAt: 1 }).select("firstAt").lean();

  const viewCountByGuardian = new Map<string, number>();
  const lastViewByGuardian = new Map<string, Date>();
  const surfacesByGuardian = new Map<string, Map<string, number>>();
  const surfaceTotals = new Map<string, { views: number; guardians: Set<string>; lastAt: Date | null }>();
  for (const v of viewRows) {
    const gk = v.guardianId.toString();
    const n = v.count ?? 1;
    viewCountByGuardian.set(gk, (viewCountByGuardian.get(gk) ?? 0) + n);
    const at = new Date(v.lastAt);
    const prevSeen = lastViewByGuardian.get(gk);
    if (!prevSeen || at > prevSeen) lastViewByGuardian.set(gk, at);

    const perG = surfacesByGuardian.get(gk) ?? new Map<string, number>();
    perG.set(v.surface, (perG.get(v.surface) ?? 0) + n);
    surfacesByGuardian.set(gk, perG);

    const tot = surfaceTotals.get(v.surface) ?? { views: 0, guardians: new Set<string>(), lastAt: null };
    tot.views += n;
    tot.guardians.add(gk);
    if (!tot.lastAt || at > tot.lastAt) tot.lastAt = at;
    surfaceTotals.set(v.surface, tot);
  }

  // --- signal 3: inbox -----------------------------------------------------
  const inboxRows = await Notification.find({
    recipientGuardianId: { $in: guardianIds },
    createdAt: { $gte: since },
  })
    .select("recipientGuardianId kind readAt")
    .lean();
  const deliveredByGuardian = new Map<string, number>();
  const readByGuardian = new Map<string, number>();
  const inboxByKind = new Map<string, { delivered: number; read: number }>();
  for (const n of inboxRows) {
    const gk = n.recipientGuardianId?.toString();
    if (gk) {
      deliveredByGuardian.set(gk, (deliveredByGuardian.get(gk) ?? 0) + 1);
      if (n.readAt) readByGuardian.set(gk, (readByGuardian.get(gk) ?? 0) + 1);
    }
    const k = inboxByKind.get(n.kind) ?? { delivered: 0, read: 0 };
    k.delivered += 1;
    if (n.readAt) k.read += 1;
    inboxByKind.set(n.kind, k);
  }

  // --- assemble ------------------------------------------------------------
  let rows: EngagementGuardianRow[] = guardians.map((g) => {
    const gk = g._id.toString();
    const lastLoginAt = lastLoginByGuardian.get(gk) ?? null;
    const activeDays = activeDayKeysInWindow.get(gk)?.size ?? 0;
    const perG = surfacesByGuardian.get(gk);
    const topSurfaces = perG
      ? [...perG.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
      : [];
    return {
      guardianId: gk,
      name: g.name,
      phone: g.phone ?? null,
      loginEnabled: !!g.loginEnabled,
      childNames: childrenByGuardian.get(gk) ?? [],
      sectionNames: [...(sectionsByGuardian.get(gk) ?? [])],
      band: bandOf(activeDays, lastLoginAt, !!g.loginEnabled, now),
      lastLoginAt: lastLoginAt ? lastLoginAt.toISOString() : null,
      loginCount: loginCountInWindow.get(gk) ?? 0,
      activeDays,
      notificationsDelivered: deliveredByGuardian.get(gk) ?? 0,
      notificationsRead: readByGuardian.get(gk) ?? 0,
      viewCount: viewCountByGuardian.get(gk) ?? 0,
      lastViewAt: lastViewByGuardian.get(gk)?.toISOString() ?? null,
      topSurfaces,
    };
  });

  // --- student-level reachability (D-#474) ---------------------------------
  // The guardian rows answer "who ignores the app"; THIS answers "which child's family
  // cannot be reached", which is the question the school actually acts on. They differ
  // whenever a student has more than one designated guardian: chasing a parent whose
  // spouse already reads everything is wasted effort, and the guardian view cannot see
  // that. Reachable = ANY designated guardian of that student has ever signed in.
  const guardiansByStudent = new Map<string, string[]>();
  for (const l of activeLinks) {
    const sk = l.studentId.toString();
    const arr = guardiansByStudent.get(sk) ?? [];
    arr.push(l.guardianId.toString());
    guardiansByStudent.set(sk, arr);
  }
  const loginEnabledById = new Map(allGuardians.map((g) => [g._id.toString(), !!g.loginEnabled]));
  let studentsReachable = 0;
  let studentsUnreachable = 0;
  let studentsNoCredentials = 0;
  for (const [, gs] of guardiansByStudent) {
    if (gs.some((g) => lastLoginByGuardian.has(g))) studentsReachable++;
    else {
      studentsUnreachable++;
      if (!gs.some((g) => loginEnabledById.get(g))) studentsNoCredentials++;
    }
  }

  // Summary is computed over ALL designated guardians before any filter — a
  // section-filtered view must not silently redefine the school-wide denominator.
  const summary: EngagementSummary = {
    totalGuardians: rows.length,
    loginEnabled: rows.filter((r) => r.loginEnabled).length,
    contactOnly: rows.filter((r) => !r.loginEnabled).length,
    everLoggedIn: rows.filter((r) => r.lastLoginAt !== null).length,
    neverLoggedIn: rows.filter((r) => r.loginEnabled && r.lastLoginAt === null).length,
    active7: rows.filter((r) => r.lastLoginAt && now - Date.parse(r.lastLoginAt) <= 7 * DAY_MS).length,
    active30: rows.filter((r) => r.lastLoginAt && now - Date.parse(r.lastLoginAt) <= 30 * DAY_MS).length,
    active90: rows.filter((r) => r.lastLoginAt && now - Date.parse(r.lastLoginAt) <= 90 * DAY_MS).length,
    regular: rows.filter((r) => r.band === "REGULAR").length,
    occasional: rows.filter((r) => r.band === "OCCASIONAL").length,
    lapsed: rows.filter((r) => r.band === "LAPSED").length,
    studentsTotal: guardiansByStudent.size,
    studentsReachable,
    studentsUnreachable,
    studentsNoCredentials,
    excludedNonDesignated: excluded.length,
    excludedButLoginEnabled: excluded.filter((g) => g.loginEnabled === true).length,
    notificationsDelivered: inboxRows.length,
    notificationsRead: inboxRows.filter((n) => n.readAt).length,
    viewsRecorded: [...viewCountByGuardian.values()].reduce((a, b) => a + b, 0),
    viewsSince: oldestView?.firstAt ? new Date(oldestView.firstAt).toISOString() : null,
    windowDays,
  };

  if (input.sectionId) {
    rows = rows.filter((r) => sectionIdsByGuardian.get(r.guardianId)?.has(input.sectionId!));
  }
  if (input.band) {
    rows = rows.filter((r) => r.band === input.band);
  }

  // Least-engaged first: this report exists to produce a chase list, so the families
  // needing action must not be buried under the ones already using the app.
  const BAND_ORDER: Record<GuardianEngagementBand, number> = {
    NO_LOGIN: 0, // no password issued — the school's own next action
    NEVER: 1, // has a password, never used it — the chase list proper
    LAPSED: 2,
    OCCASIONAL: 3,
    REGULAR: 4,
  };
  rows.sort(
    (a, b) =>
      BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
      a.activeDays - b.activeDays ||
      a.name.localeCompare(b.name),
  );

  const surfaces: SurfaceUsage[] = GUARDIAN_VIEW_SURFACES.map((s) => {
    const t = surfaceTotals.get(s);
    return {
      surface: s,
      views: t?.views ?? 0,
      distinctGuardians: t?.guardians.size ?? 0,
      lastAt: t?.lastAt ? t.lastAt.toISOString() : null,
    };
  }).sort((a, b) => b.views - a.views);

  return {
    summary,
    guardians: rows,
    surfaces,
    inboxByKind: [...inboxByKind.entries()]
      .map(([kind, v]) => ({ kind, delivered: v.delivered, read: v.read }))
      .sort((a, b) => b.delivered - a.delivered),
    generatedAt: new Date(now).toISOString(),
  };
}
