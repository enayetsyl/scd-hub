/**
 * Authentication state. At boot we hydrate the persisted JWT and resolve `me`;
 * login runs staffLogin → stores the token → resolves `me`. Role from `me`
 * drives which tabs render (PRD §8 RBAC rules). The token is held only in
 * lib/tokenStore and never exposed here.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { useClient } from "urql";
import {
  ME_QUERY,
  STAFF_LOGIN,
  GUARDIAN_LOGIN,
  START_IMPERSONATION,
  END_IMPERSONATION,
  type MeUser,
} from "../graphql/operations";
import { hydrateToken, persistToken, getRealToken, persistRealToken, getToken } from "../lib/tokenStore";
import { getItem, setItem, removeItem } from "../lib/storage";
import { clearNavState } from "../lib/navState";
import { friendlyError } from "../lib/errors";
import { registerPushToken, unregisterPushToken } from "../lib/push";
import { STR } from "../lib/labels";
import { type Role } from "@scd/shared";

type Status = "loading" | "authed" | "anon";

/** Where the chosen hat is persisted, so a reload/relaunch keeps the user in it. */
const VIEW_MODE_KEY = "scd_view_mode";

/** Who the Principal is currently viewing as, and until when (VA-1, D-#638). */
const VIEW_AS_KEY = "scd_view_as";

/** The borrowed session, as the banner needs to render it. */
export interface ViewAsSession {
  name: string;
  role: Role;
  /** Epoch ms. The server's TTL, resolved to wall-clock at the moment of the swap. */
  expiresAt: number;
}

function parseViewAs(raw: string | null): ViewAsSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ViewAsSession;
    return v && typeof v.name === "string" && typeof v.expiresAt === "number" ? v : null;
  } catch {
    return null;
  }
}

interface AuthContextValue {
  status: Status;
  user: MeUser | null;
  /** The account's primary role — the one that must pick exactly ONE behaviour (which
   *  dashboard component renders, which landing screen). For a VISIBILITY gate on a
   *  two-hat login prefer `isRole`, which honours both templates; a bare
   *  `role === "OFFICE"` hides office surfaces from a teacher who also runs the desk. */
  role: Role | null;
  /** Identical to `role`. Kept as a distinct name for the call sites that mean "who am
   *  I really" rather than "how should this screen behave". */
  primaryRole: Role | null;
  /** The caller's OWN effective permissions (role template(s) + grants − revocations),
   *  exactly as the server resolved them. Prefer `can()` over `roleHasPermission(role, …)`
   *  for any NEW gate: the template alone is blind to per-user grants (AC-1), which is how
   *  the book-production roles are assigned (D-#405). Empty until `me` resolves. */
  permissions: string[];
  /** Should this screen/tile be OFFERED? Never the authorization gate — every resolver
   *  re-checks server-side; this only avoids showing a door that will not open. */
  can: (perm: string) => boolean;
  /** The role templates this login holds (primary first). A two-hat account holds two;
   *  every one of them is in force at once (D-#467 superseded — see `isRole`). */
  templates: Role[];
  /** "Does this login act as role R?" — the template-aware replacement for a bare
   *  `role === "OFFICE"` VISIBILITY gate. ANY held template answers true, so a teacher
   *  who also runs the office desk sees the office-only surfaces (the Reports tab) that
   *  a primary-role comparison hid from them. Use `role` instead when the code must pick
   *  exactly ONE behaviour (e.g. which dashboard component to render). */
  isRole: (r: Role) => boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  /** The account being borrowed right now, or null in one's own account (VA-1, D-#638). */
  viewAs: ViewAsSession | null;
  /** True while wearing someone else's account. Gates the banner AND every device-bound
   *  side effect — see the push-registration guard below. */
  isImpersonating: boolean;
  /** Open another account's view. Principal only; the server is the gate. */
  startViewAs: (targetId: string, targetKind: "STAFF" | "GUARDIAN") => Promise<{ ok: boolean; message?: string }>;
  /** Hand the Principal their own account back. Also the expiry path. */
  returnToSelf: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<MeUser | null>(null);
  const [rawPermissions, setRawPermissions] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Role[]>([]);
  const [viewAs, setViewAs] = useState<ViewAsSession | null>(null);

  const resolveMe = useCallback(async (): Promise<MeUser | null> => {
    const res = await client.query(ME_QUERY, {}, { requestPolicy: "network-only" }).toPromise();
    // One query, all three answers — see ME_QUERY. Permissions/templates are set even
    // when `me` comes back null so a rejected session never leaves a stale set behind.
    setRawPermissions(res.data?.myPermissions ?? []);
    setTemplates((res.data?.myTemplates ?? []) as Role[]);
    return res.data?.me ?? null;
  }, [client]);

  // The D-#467 hat switcher is gone: a two-hat login now always sees both jobs at once.
  // This clears any hat a device is still holding from the old build — without it, a
  // person who had picked শিক্ষক or অফিস would stay narrowed to that half forever, with
  // no UI left to widen it again. Safe to delete once no install predates this release.
  useEffect(() => {
    void removeItem(VIEW_MODE_KEY);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let token = await hydrateToken();

      /**
       * Recover from a View-as session that outlived the app (VA-1, G5). A crash, a
       * reload or a relaunch must never strand the Principal in someone else's account
       * — or, worse, log them out because a borrowed token had quietly expired.
       *
       * A parked token that is past its window (or has no session record at all) is
       * simply taken back before anything else runs.
       */
      const parked = await getRealToken();
      if (parked) {
        const saved = parseViewAs(await getItem(VIEW_AS_KEY));
        if (!token || !saved || saved.expiresAt <= Date.now()) {
          await persistToken(parked);
          await persistRealToken(null);
          await removeItem(VIEW_AS_KEY);
          await clearNavState();
          token = parked;
        } else if (!cancelled) {
          setViewAs(saved);
        }
      }

      if (!token) {
        if (!cancelled) setStatus("anon");
        return;
      }
      const me = await resolveMe();
      if (cancelled) return;
      if (me) {
        setUser(me);
        setStatus("authed");
      } else {
        await persistToken(null);
        setStatus("anon");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveMe]);

  /**
   * Register this device for push once authenticated (AT-4, D-#65). Best-effort;
   * never blocks the session (web/simulator/denied → silent no-op).
   *
   * NOT while impersonating (VA-1, G4). This effect fires on every transition to
   * `authed`, so a borrowed session would bind the PRINCIPAL's device to the teacher's
   * user id — her উপস্থিতি রিমাইন্ডার would then ring on his phone, and the unregister
   * on the way out would delete her real registration. A View-as session is a look at
   * someone's account, never a claim on their notifications.
   */
  useEffect(() => {
    if (status === "authed" && !viewAs) void registerPushToken(client);
  }, [status, client, viewAs]);

  const login = useCallback(
    async (email: string, password: string) => {
      const id = email.trim();
      const res = await client.mutation(STAFF_LOGIN, { email: id, password }).toPromise();
      if (res.error) return { ok: false, message: friendlyError(res.error) };
      let auth = res.data?.staffLogin ?? null;
      // Guardian family fallback (GP-2, J5.2/D-#59): no staff account matched —
      // try the flexible guardian login with the same identifier (phone unless
      // it looks like an email).
      if (!auth) {
        const gres = await client
          .mutation(GUARDIAN_LOGIN, {
            identifier: id,
            identifierKind: id.includes("@") ? "email" : "phone",
            password,
          })
          .toPromise();
        if (gres.error) return { ok: false, message: friendlyError(gres.error) };
        auth = gres.data?.guardianLogin ?? null;
      }
      if (!auth) return { ok: false, message: STR.loginInvalid };

      await persistToken(auth.token);
      const me = await resolveMe();
      if (!me) {
        await persistToken(null);
        return { ok: false, message: STR.loginInvalid };
      }
      setUser(me);
      setStatus("authed");
      return { ok: true };
    },
    [client, resolveMe],
  );

  /**
   * Swap into another account (VA-1, D-#638).
   *
   * Order matters: park the real token BEFORE overwriting it, and never call
   * `unregisterPushToken` on the way in or out — that path belongs to a real logout, and
   * running it here would deactivate the borrowed account's own device (G4).
   */
  const startViewAs = useCallback(
    async (targetId: string, targetKind: "STAFF" | "GUARDIAN") => {
      const res = await client.mutation(START_IMPERSONATION, { targetId, targetKind }).toPromise();
      if (res.error) return { ok: false, message: friendlyError(res.error) };
      const started = res.data?.startImpersonation;
      if (!started) return { ok: false, message: STR.viewAsFailed };

      const own = getToken();
      if (own) await persistRealToken(own);
      await persistToken(started.token);

      const session: ViewAsSession = {
        name: started.name,
        role: started.role as Role,
        expiresAt: Date.now() + started.expiresInSeconds * 1000,
      };
      await setItem(VIEW_AS_KEY, JSON.stringify(session));

      // The borrowed account renders a different tab set, and a persisted tree can name
      // a route it does not have (G5).
      await clearNavState();
      setViewAs(session);

      const me = await resolveMe();
      if (!me) {
        // The token was refused — put the Principal straight back rather than leaving
        // them in a half-swapped state.
        const parked = await getRealToken();
        if (parked) await persistToken(parked);
        await persistRealToken(null);
        await removeItem(VIEW_AS_KEY);
        setViewAs(null);
        await resolveMe();
        return { ok: false, message: STR.viewAsFailed };
      }
      setUser(me);
      setStatus("authed");
      return { ok: true };
    },
    [client, resolveMe],
  );

  /** Give the Principal their own account back. Also the expiry path. */
  const returnToSelf = useCallback(async () => {
    const parked = await getRealToken();
    // Best-effort END row, sent while the borrowed token still works. A failure here
    // must not trap anyone in the wrong account, so it is deliberately unguarded.
    try {
      await client.mutation(END_IMPERSONATION, {}).toPromise();
    } catch {
      /* the START row and the TTL already bound the session */
    }
    await persistToken(parked);
    await persistRealToken(null);
    await removeItem(VIEW_AS_KEY);
    await clearNavState();
    setViewAs(null);
    if (!parked) {
      // Nothing to go back to (should not happen) — a login is better than a blank app.
      setUser(null);
      setStatus("anon");
      return;
    }
    const me = await resolveMe();
    setUser(me);
    setStatus(me ? "authed" : "anon");
  }, [client, resolveMe]);

  const logout = useCallback(async () => {
    // N4.1: deactivate this device's push token while the session still works.
    await unregisterPushToken(client);
    await persistToken(null);
    // A logout from inside a View-as session ends the session too — leaving a parked
    // token behind would hand the next person to log in the Principal's own account.
    await persistRealToken(null);
    await removeItem(VIEW_AS_KEY);
    setViewAs(null);
    setUser(null);
    setRawPermissions([]);
    setTemplates([]);
    setStatus("anon");
  }, [client]);

  // What the app offers = exactly what the server reported this caller may do. There is
  // no longer a hat to narrow it (the D-#467 switcher is gone), so this is the effective
  // set verbatim. The server was always the only gate; nothing about authority changes.
  const permissions = useMemo(() => [...rawPermissions], [rawPermissions]);

  const can = useCallback((perm: string) => permissions.includes(perm), [permissions]);

  const isRole = useCallback(
    // Every template the login holds counts at once, so a teacher who also runs the
    // office desk sees both surfaces. Falls back to the primary role while `me` is
    // still resolving, so boot behaviour is unchanged.
    (r: Role) => (templates.length > 0 ? templates.includes(r) : user?.role === r),
    [templates, user],
  );

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        role: user?.role ?? null,
        primaryRole: user?.role ?? null,
        permissions,
        can,
        templates,
        isRole,
        login,
        logout,
        viewAs,
        isImpersonating: viewAs !== null,
        startViewAs,
        returnToSelf,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
