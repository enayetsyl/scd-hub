/**
 * AnnouncementPopup (D-#700) — a school-wide notice shown to a guardian once on
 * their first app open of each day, while the announcement's window is open.
 *
 * WHY A POPUP AND NOT ANOTHER NOTIFICATION. The inbox already holds 677
 * `EXAM_SYLLABUS_PUBLISHED` rows — one per published syllabus per guardian —
 * and 535 of them are unread. Adding to a channel people have stopped reading
 * does not reach them; interrupting once a day, briefly, does.
 *
 * "ONCE A DAY" IS MEASURED IN SCHOOL DAYS, NOT DEVICE DAYS. The server sends
 * `todayKey` (Asia/Dhaka) with the announcement and this component stores the
 * key it last showed. A device with a wrong clock, or a guardian abroad, still
 * gets exactly one showing per school day, and the app never needs its own
 * timezone conversion — a second implementation of "what day is it" is how the
 * two drift apart.
 *
 * The seen-key is per DEVICE (the storage shim: SecureStore native, localStorage
 * web). A guardian who uses both a phone and a laptop sees it once on each, the
 * same day. That is the accepted cost of not writing to the database on every
 * app open; the alternative is a mutation per guardian per day for a message
 * that runs for a week.
 *
 * Fail-silent throughout. This mounts inside the authenticated shell, so every
 * failure path — no announcement, a query error, storage unavailable — must
 * render nothing rather than break the app for a parent who came in to check
 * homework.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import { MY_ANNOUNCEMENT } from "../graphql/announcement";
import { Button } from "./ui";
import { STR } from "../lib/labels";
import { getItem, setItem } from "../lib/storage";
import { useAuth } from "../auth/AuthContext";
import { navigationRef } from "../navigation/navigationRef";
import { makeStyles, radius, space, typeScale } from "../theme";

/** One key per announcement, so a NEW announcement is never suppressed by an
 *  old one's "already seen today". */
const seenKey = (id: string): string => `scd_announcement_seen_${id}`;

export function AnnouncementPopup(): React.ReactElement | null {
  const { status, role } = useAuth();
  // `role` (the primary role), not `isRole`: this is "whose app IS this", not
  // "may they see a surface". A guardian login holds exactly one template.
  const isGuardian = status === "authed" && role === "GUARDIAN";

  // Staff never ask. The server would answer null anyway, but there is no reason
  // to spend a round trip per staff app-open to be told so.
  const [result] = useQuery({ query: MY_ANNOUNCEMENT, pause: !isGuardian });
  const announcement = result.data?.myAnnouncement ?? null;

  const [visible, setVisible] = useState(false);
  const [decidedFor, setDecidedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!announcement) return;
    // Guard against re-deciding on every render once we have already answered
    // for this (announcement, day) pair.
    const stamp = `${announcement.id}:${announcement.todayKey}`;
    if (decidedFor === stamp) return;

    let cancelled = false;
    void (async () => {
      let lastShown: string | null = null;
      try {
        lastShown = await getItem(seenKey(announcement.id));
      } catch {
        // Storage unavailable (private window, blocked site data). Showing it is
        // the better failure: an announcement seen twice beats one never seen.
        lastShown = null;
      }
      if (cancelled) return;
      setDecidedFor(stamp);
      if (lastShown !== announcement.todayKey) setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [announcement, decidedFor]);

  const dismiss = useCallback(
    async (thenGo: boolean) => {
      setVisible(false);
      if (announcement) {
        try {
          // Written on dismiss, not on show: if the app is killed mid-render the
          // parent has not actually read anything, and should see it next time.
          await setItem(seenKey(announcement.id), announcement.todayKey);
        } catch {
          /* non-fatal — at worst it shows again */
        }
        if (thenGo && announcement.deepLinkTab && navigationRef.isReady()) {
          try {
            (navigationRef as unknown as { navigate: (n: string) => void }).navigate(
              announcement.deepLinkTab,
            );
          } catch {
            // An unknown tab name (renamed route, stale announcement row) must
            // not crash the shell — closing the popup is a fine outcome.
          }
        }
      }
    },
    [announcement],
  );

  const styles = useStyles();
  const insets = useSafeAreaInsets();

  if (!isGuardian || !announcement || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void dismiss(false)}>
      <View style={styles.backdropWrap}>
        <Pressable
          style={styles.backdrop}
          onPress={() => void dismiss(false)}
          accessibilityLabel={STR.close}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <Text style={styles.title}>{announcement.titleBn}</Text>
          {/* Scrolls: an announcement is prose the office types, and a long one
              must not push its own buttons off a small screen. */}
          <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyInner}>
            <Text style={styles.message}>{announcement.bodyBn}</Text>
          </ScrollView>
          <View style={styles.buttons}>
            <Button
              title={STR.anLater}
              variant="secondary"
              onPress={() => void dismiss(false)}
              style={styles.button}
            />
            {announcement.deepLinkTab ? (
              <Button
                title={announcement.ctaBn || STR.anOpen}
                variant="primary"
                onPress={() => void dismiss(true)}
                style={styles.button}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary, marginBottom: space(2) },
  bodyScroll: { maxHeight: 280 },
  bodyInner: { paddingBottom: space(1) },
  message: { ...typeScale.body, color: colors.textSecondary },
  buttons: { flexDirection: "row", gap: space(3), marginTop: space(4) },
  button: { flex: 1 },
}));
