/**
 * Unread-notification badge state (N3.1). One shared poll of
 * `myUnreadNotificationCount` (60s, authed sessions only) feeds the 🔔 badge in
 * every stack header; `refresh()` lets the NotificationCenter snap the count
 * after markRead / mark-all instead of waiting for the next poll.
 */
import React, { createContext, useCallback, useContext, useEffect } from "react";
import { useQuery } from "urql";
import { MY_UNREAD_NOTIFICATION_COUNT } from "../graphql/operations";
import { useAuth } from "../auth/AuthContext";

const POLL_MS = 60_000;

interface NotificationContextValue {
  unreadCount: number;
  refresh: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  refresh: () => undefined,
});

export function NotificationProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status } = useAuth();
  const authed = status === "authed";
  const [result, reexecute] = useQuery({
    query: MY_UNREAD_NOTIFICATION_COUNT,
    pause: !authed,
    requestPolicy: "cache-and-network",
  });

  const refresh = useCallback(() => {
    if (authed) reexecute({ requestPolicy: "network-only" });
  }, [authed, reexecute]);

  useEffect(() => {
    if (!authed) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [authed, refresh]);

  const unreadCount = authed ? result.data?.myUnreadNotificationCount ?? 0 : 0;

  return (
    <NotificationContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext);
}
