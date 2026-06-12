/**
 * Authentication state. At boot we hydrate the persisted JWT and resolve `me`;
 * login runs staffLogin → stores the token → resolves `me`. Role from `me`
 * drives which tabs render (PRD §8 RBAC rules). The token is held only in
 * lib/tokenStore and never exposed here.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useClient } from "urql";
import { ME_QUERY, STAFF_LOGIN, GUARDIAN_LOGIN, type MeUser } from "../graphql/operations";
import { hydrateToken, persistToken } from "../lib/tokenStore";
import { friendlyError } from "../lib/errors";
import { STR } from "../lib/labels";
import type { Role } from "@scd/shared";

type Status = "loading" | "authed" | "anon";

interface AuthContextValue {
  status: Status;
  user: MeUser | null;
  role: Role | null;
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<MeUser | null>(null);

  const resolveMe = useCallback(async (): Promise<MeUser | null> => {
    const res = await client.query(ME_QUERY, {}, { requestPolicy: "network-only" }).toPromise();
    return res.data?.me ?? null;
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await hydrateToken();
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

  const logout = useCallback(async () => {
    await persistToken(null);
    setUser(null);
    setStatus("anon");
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, role: user?.role ?? null, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
