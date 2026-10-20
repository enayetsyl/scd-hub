/**
 * useTodayKey — today's Dhaka date key ("YYYY-MM-DD"), kept current.
 *
 * A screen that computes "today" once at mount keeps YESTERDAY's date when it is
 * left open overnight — a mobile browser restores the tab without reloading it, and
 * the app resumes from the background the same way. The attendance screens did this:
 * the first submit of every morning went out with yesterday's date and the server
 * refused it as a locked day (owner report 2026-10-20, Akbor, 07:04–07:47 two days
 * running). This re-reads the date whenever the screen regains focus or the app/tab
 * comes back to the foreground (react-native-web maps `visibilitychange` to AppState).
 */
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { dhakaDateKey } from "./labels";

export function useTodayKey(): string {
  const [today, setToday] = useState(() => dhakaDateKey());
  const refresh = useCallback(() => setToday(dhakaDateKey()), []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return today;
}
