/**
 * PopupNoticeHost (D-#852/#855) — shows today's pop-up notices to whoever is signed in,
 * staff or guardian, one at a time, and records what happened on the server.
 *
 * It replaces the D-#700 AnnouncementPopup: the server now decides what is due (once /
 * daily / every open / for the window) from per-person rows, so finishing a notice on the
 * phone ends it on the laptop too. The queue arrives already ordered — answer-required,
 * then read-required, then at most three quick-info — and this host only walks it.
 *
 * WHEN IT ASKS. On mount (an app open) and when the app comes back to the front after
 * ten minutes away. Not on every resume: a guardian flipping to WhatsApp and back is not
 * "opening the app", and an every-open notice would chase them in a loop.
 *
 * Mounted beside the navigator in App.tsx, BEFORE the meeting pop-up (D-#841) so that
 * blocking pop-up renders on top. Fail-silent: a query or mutation error renders nothing
 * and never breaks the shell (the 791e5fe rule).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { useMutation, useQuery } from "urql";
import { MY_POPUP_QUEUE, RECORD_POPUP_EVENT, type PopupActionT, type PopupEventVars, type PopupShowT } from "../graphql/popupNotice";
import { PopupSheet } from "./PopupSheet";
import { useAuth } from "../auth/AuthContext";
import { navigateInTab, navigationRef } from "../navigation/navigationRef";
import { friendlyError } from "../lib/errors";
import { useSystemPopupActive } from "../lib/popupSlot";

const REFRESH_AFTER_MS = 10 * 60 * 1000;
const keyOf = (s: PopupShowT): string => `${s.noticeId}:${s.test ? "t" : "r"}`;

/** "আমাকে আগে পাঠান" asks for a look now, not on the next app open. */
const refreshListeners = new Set<() => void>();
export function refreshPopupQueue(): void {
  refreshListeners.forEach((fn) => fn());
}

/** Open an app screen by its route name — a tab ("HomeTab") or a screen inside a tab
 *  ("HomeTab/MeetingCommentGuide", D-#871). An unknown name just leaves the pop-up closed. */
export function openPopupTarget(target: string): void {
  if (!target || !navigationRef.isReady()) return;
  if (target.includes("/")) {
    const [tab, screen] = target.split("/");
    navigateInTab(tab, screen);
    return;
  }
  try {
    (navigationRef as unknown as { navigate: (n: string) => void }).navigate(target);
  } catch {
    /* a renamed route must not crash the shell */
  }
}

export function PopupNoticeHost(): React.ReactElement | null {
  const { status } = useAuth();
  const authed = status === "authed";
  const [q, refetch] = useQuery({ query: MY_POPUP_QUEUE, pause: !authed, requestPolicy: "network-only" });
  const [, record] = useMutation(RECORD_POPUP_EVENT);

  const handled = useRef(new Set<string>());
  const shownInSession = useRef(0);
  const lastFetch = useRef(Date.now());
  const [current, setCurrent] = useState<{ show: PopupShowT; index: number; total: number } | null>(null);

  // The meeting RSVP / comment reminder go first; a notice never covers them (D-#871).
  const systemBusy = useSystemPopupActive();
  const due = (q.data?.myPopupQueue ?? []).filter((s) => !handled.current.has(keyOf(s)));
  // A string, not the array: the array is new on every render and would restart the delay.
  const dueKey = due.map(keyOf).join("|");

  useEffect(() => {
    if (current || systemBusy || due.length === 0) return;
    const next = due[0];
    const remaining = due.length;
    const t = setTimeout(() => {
      shownInSession.current += 1;
      setCurrent({ show: next, index: shownInSession.current, total: shownInSession.current + remaining - 1 });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, dueKey, systemBusy]);

  // A sign-out / sign-in starts a fresh session of pop-ups.
  useEffect(() => {
    if (!authed) {
      handled.current.clear();
      shownInSession.current = 0;
      setCurrent(null);
    }
  }, [authed]);

  useEffect(() => {
    const fn = () => {
      lastFetch.current = Date.now();
      // A second test of the same draft must show again.
      for (const k of [...handled.current]) if (k.endsWith(":t")) handled.current.delete(k);
      refetch({ requestPolicy: "network-only" });
    };
    refreshListeners.add(fn);
    return () => {
      refreshListeners.delete(fn);
    };
  }, [refetch]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || !authed) return;
      if (Date.now() - lastFetch.current < REFRESH_AFTER_MS) return;
      lastFetch.current = Date.now();
      handled.current.clear();
      shownInSession.current = 0;
      refetch({ requestPolicy: "network-only" });
    });
    return () => sub.remove();
  }, [authed, refetch]);

  const send = useCallback(
    async (show: PopupShowT, input: Omit<PopupEventVars["input"], "noticeId" | "test" | "device">) => {
      try {
        return await record({ input: { ...input, noticeId: show.noticeId, test: show.test, device: Platform.OS } });
      } catch {
        return null;
      }
    },
    [record],
  );

  const done = useCallback(() => {
    if (current) handled.current.add(keyOf(current.show));
    setCurrent(null);
  }, [current]);

  if (!authed || !current) return null;
  const show = current.show;

  return (
    <PopupSheet
      key={keyOf(show)}
      show={show}
      position={{ index: current.index, total: current.total }}
      onSeen={() => void send(show, { kind: "SEEN" })}
      onRead={(readMs) => void send(show, { kind: "READ", readMs })}
      onClose={(method, readMs) => {
        void send(show, { kind: "CLOSED", method, readMs });
        done();
      }}
      onSnooze={(readMs) => {
        void send(show, { kind: "SNOOZED", readMs });
        done();
      }}
      onAct={async (action: PopupActionT, readMs) => {
        const res = await send(show, { kind: "ACTED", choiceId: action.id, readMs });
        if (res?.error) return friendlyError(res.error);
        done();
        if (action.kind === "OPEN_SCREEN") openPopupTarget(action.target);
        if (action.kind === "OPEN_LINK" && action.target) void Linking.openURL(action.target);
        return null;
      }}
    />
  );
}
