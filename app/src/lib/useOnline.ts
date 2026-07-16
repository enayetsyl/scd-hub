/**
 * Connectivity hook for QueryGate (ux-audit F2): subscribes to NetInfo and
 * reports whether the device currently has a network connection. `isConnected`
 * is tri-state (`null` = unknown, e.g. before the first probe) — unknown is
 * treated as ONLINE so we never show the offline message speculatively.
 */
import React from "react";
import NetInfo from "@react-native-community/netinfo";

export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    });
    return unsubscribe;
  }, []);
  return online;
}
