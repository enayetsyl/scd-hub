/**
 * useRecordView (GE-2, D-#465) — reports that the calling guardian opened a portal
 * surface, so the engagement report can answer "which screens do families use".
 *
 * Three rules this hook exists to enforce, all of which were easy to get wrong if each
 * screen called the mutation itself:
 *
 *   1. GUARDIANS ONLY. A Principal browsing a child screen is not a family using the
 *      portal; counting staff would quietly corrupt every figure in the report.
 *   2. ONCE PER FOCUS, not once per render. Screens here re-render on every urql result
 *      (GuardianHomeScreen alone runs 12 queries), and a render-counted "view" would
 *      measure React, not attention.
 *   3. NEVER BLOCK OR SURFACE. The mutation is fire-and-forget: no await on the render
 *      path, no error state, no retry. Telemetry must not be able to break a screen.
 *
 * The server collapses repeat opens to one row per surface per child per Dhaka day, so
 * a chatty screen costs a counter increment rather than a row.
 */
import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useMutation } from "urql";
import { RECORD_GUARDIAN_VIEW } from "../graphql/engagement";
import { useAuth } from "../auth/AuthContext";

export function useRecordView(surface: string, studentId?: string | null, refId?: string | null): void {
  const { role } = useAuth();
  const [, record] = useMutation(RECORD_GUARDIAN_VIEW);
  // Focus can fire repeatedly for one visit (tab switches, keyboard, remount on web
  // where hidden stack screens stay mounted). Key the guard on what identifies the
  // view so switching CHILD still registers, but re-focusing the same one does not.
  const lastKey = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (role !== "GUARDIAN") return;
      const key = `${surface}|${studentId ?? ""}|${refId ?? ""}`;
      if (lastKey.current === key) return;
      lastKey.current = key;
      void record({ surface, studentId: studentId ?? null, refId: refId ?? null }).catch(() => {
        // Deliberately silent — a dropped view row is a lost count, nothing more.
      });
    }, [role, surface, studentId, refId, record]),
  );
}
