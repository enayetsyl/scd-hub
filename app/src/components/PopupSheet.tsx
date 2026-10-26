/**
 * PopupSheet (D-#852, PRD §5) — one pop-up notice on screen, with its close rules enforced.
 *
 *   auto-close    a bar runs down N seconds — but never on long text the reader has not
 *                 scrolled to the end of (§5.3-1); it waits at the bottom instead
 *   scroll        ✕ stays locked until the end of the message has been on screen; a progress
 *                 bar and a "নিচে আরও আছে ↓" pill show there is more
 *   minimum time  ✕ shows the seconds left and stays locked; the clock counts only while the
 *                 app is in the foreground, so leaving the app does not skip it (§5.3-4)
 *   answer        no ✕; only an answer button closes it
 * A refused close (✕, the backdrop, Android Back, a locked button) shakes the sheet once and
 * names exactly what is left, in Bangla. Nobody is left guessing why it will not close.
 *
 * Presentational: it reports what happened through callbacks and the host decides what to
 * record. `reread` (আমার বার্তা) drops every lock — the person is choosing to read it again.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "./Markdown";
import { Button } from "./ui";
import { STR, bnNum, getActiveLang } from "../lib/labels";
import { autoCloseRunning, hasReadingRule, readingUnmet, unmetRules, type Unmet } from "../lib/popupRules";
import type { PopupActionT, PopupShowT } from "../graphql/popupNotice";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

const TICK_MS = 250;

export interface PopupSheetProps {
  show: PopupShowT;
  /** "১/৩" — this notice's place in today's queue. */
  position?: { index: number; total: number };
  reread?: boolean;
  onSeen?: () => void;
  onRead?: (readMs: number) => void;
  onClose: (method: "auto" | "button", readMs: number) => void;
  /** Resolves to an error message to show, or null when the answer was recorded. */
  onAct?: (action: PopupActionT, readMs: number) => Promise<string | null>;
  onSnooze?: (readMs: number) => void;
}

export function hintText(u: Unmet): string {
  if (u.kind === "scroll") return STR.ppHintScroll;
  if (u.kind === "time") return STR.ppHintTime.replace("{n}", bnNum(u.secondsLeft ?? 0));
  return STR.ppHintAct;
}

export function PopupSheet({ show, position, reread = false, onSeen, onRead, onClose, onAct, onSnooze }: PopupSheetProps): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const en = getActiveLang() === "en";
  const rules = reread
    ? { ...show.rules, autoCloseSec: 0, mustScrollToEnd: false, minReadSec: 0, mustAct: false, closeButton: true }
    : show.rules;

  const [atEnd, setAtEnd] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [readMs, setReadMs] = useState(0);
  const [autoLeftMs, setAutoLeftMs] = useState(rules.autoCloseSec * 1000);
  const [hint, setHint] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const layoutH = useRef(0);
  const contentH = useRef(0);
  const scrollY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const foreground = useRef(AppState.currentState === "active" || AppState.currentState == null);
  const readLogged = useRef(false);
  const closed = useRef(false);
  const shake = useRef(new Animated.Value(0)).current;

  // Seen once per showing.
  useEffect(() => {
    if (!reread) onSeen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show.noticeId]);

  // The read clock runs only while the app is in front of the person.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      foreground.current = s === "active";
    });
    return () => sub.remove();
  }, []);

  const measure = useCallback(() => {
    const over = contentH.current > layoutH.current + 4;
    setOverflow(over);
    if (!over || scrollY.current + layoutH.current >= contentH.current - 8) setAtEnd(true);
  }, []);

  const finish = useCallback(
    (method: "auto" | "button") => {
      if (closed.current) return;
      closed.current = true;
      onClose(method, readMs);
    },
    [onClose, readMs],
  );

  // One clock for the read time and the auto-close countdown.
  useEffect(() => {
    const id = setInterval(() => {
      if (!foreground.current || closed.current) return;
      setReadMs((ms) => ms + TICK_MS);
      if (!reread && autoCloseRunning(rules, overflow, atEnd)) setAutoLeftMs((ms) => ms - TICK_MS);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [rules, overflow, atEnd, reread]);

  useEffect(() => {
    if (!reread && rules.autoCloseSec > 0 && autoLeftMs <= 0) finish("auto");
  }, [autoLeftMs, rules.autoCloseSec, reread, finish]);

  const state = { atEnd, readMs };
  const unmet = reread ? [] : unmetRules(rules, state);
  const readUnmet = reread ? [] : readingUnmet(rules, state);

  // READ once the reading rules are met — recorded the moment it happens, not on close.
  useEffect(() => {
    if (reread || readLogged.current || !hasReadingRule(rules) || readUnmet.length > 0) return;
    readLogged.current = true;
    onRead?.(readMs);
  }, [readUnmet.length, rules, reread, onRead, readMs]);

  // A shown hint keeps itself current and disappears once its reasons are gone.
  useEffect(() => {
    if (!hint) return;
    const next = unmetRules(rules, state).map(hintText);
    if (next.length === 0) setHint(null);
    else if (next.join("|") !== hint.join("|")) setHint(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atEnd, Math.ceil(readMs / 1000)]);

  const refuse = useCallback(
    (reasons: Unmet[]) => {
      setHint(reasons.map(hintText));
      Animated.sequence([
        Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 7, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -5, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start();
    },
    [shake],
  );

  const tryClose = useCallback(() => {
    if (unmet.length > 0) {
      refuse(unmet);
      return;
    }
    finish("button");
  }, [unmet, refuse, finish]);

  const act = useCallback(
    async (a: PopupActionT) => {
      if (readUnmet.length > 0) {
        refuse(readUnmet);
        return;
      }
      if (!onAct || busy) return;
      setBusy(true);
      const err = await onAct(a, readMs);
      setBusy(false);
      if (err) setHint([err]);
      else closed.current = true;
    },
    [readUnmet, refuse, onAct, busy, readMs],
  );

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    if (!atEnd && scrollY.current + layoutH.current >= contentH.current - 8) setAtEnd(true);
  };

  const title = en && show.titleEn ? show.titleEn : show.titleBn;
  const body = en && show.bodyEn ? show.bodyEn : show.bodyBn;
  const label = (a: PopupActionT) => (en && a.labelEn ? a.labelEn : a.labelBn);
  const toneStyle = show.tone === "urgent" ? styles.toneUrgent : show.tone === "important" ? styles.toneImportant : styles.toneInfo;
  const toneText = show.tone === "urgent" ? STR.ppToneUrgent : show.tone === "important" ? STR.ppToneImportant : STR.ppToneInfo;

  const timeLeft = readUnmet.find((u) => u.kind === "time")?.secondsLeft;
  const scrollLeft = readUnmet.some((u) => u.kind === "scroll");
  const showX = rules.closeButton && !rules.mustAct;
  const progress = !overflow || atEnd ? 1 : Math.min(1, (scrollY.current + layoutH.current) / Math.max(1, contentH.current));
  const minPct = rules.minReadSec > 0 ? Math.min(1, readMs / (rules.minReadSec * 1000)) : 1;
  // Re-reading: only a still-changeable CHOICE answer is offered; the rest is history.
  const actions = reread ? (show.canChangeAnswer ? show.actions.filter((a) => a.kind === "CHOICE") : []) : show.actions;
  const chosen = show.actions.find((a) => a.id === show.choiceId);
  const canSnooze = !reread && rules.allowSnooze && show.snoozeCount < rules.maxSnooze && !!onSnooze;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={tryClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={tryClose} accessibilityLabel={STR.close} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + space(3), transform: [{ translateX: shake }] }]}
          accessibilityViewIsModal
        >
          <View style={[styles.strip, toneStyle]} />
          <View style={styles.head}>
            <View style={styles.headText}>
              <View style={styles.meta}>
                <Text style={[styles.tone, toneStyle]}>{toneText}</Text>
                {position && position.total > 1 ? (
                  <Text style={styles.metaText}>
                    {bnNum(position.index)}/{bnNum(position.total)}
                  </Text>
                ) : null}
                {show.fromLabel ? <Text style={styles.metaText}>{show.fromLabel}</Text> : null}
                {show.test ? <Text style={[styles.metaText, { color: colors.warning }]}>{STR.ppTestBadge}</Text> : null}
              </View>
              <Text style={styles.title}>{title}</Text>
            </View>
            {showX ? (
              <Pressable
                onPress={tryClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={STR.close}
                accessibilityState={{ disabled: unmet.length > 0 }}
                style={[styles.x, { borderColor: unmet.length > 0 ? colors.border : colors.primary }]}
              >
                {timeLeft ? (
                  <Text style={styles.xCount}>{bnNum(timeLeft)}</Text>
                ) : (
                  <Text style={[styles.xMark, unmet.length > 0 && { color: colors.textDisabled }]}>✕</Text>
                )}
                {rules.minReadSec > 0 && minPct < 1 ? (
                  <View style={[styles.xRing, { width: `${Math.round(minPct * 100)}%` }]} />
                ) : null}
              </Pressable>
            ) : null}
          </View>

          {rules.mustScrollToEnd && !reread ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          ) : null}
          {rules.autoCloseSec > 0 && !reread ? (
            <>
              <View style={styles.bar}>
                <View style={[styles.barFill, styles.barAuto, { width: `${Math.max(0, Math.round((autoLeftMs / (rules.autoCloseSec * 1000)) * 100))}%` }]} />
              </View>
              <Text style={styles.autoNote}>
                {overflow && !atEnd ? STR.ppAutoWaits : STR.ppAutoIn.replace("{n}", bnNum(Math.max(0, Math.ceil(autoLeftMs / 1000))))}
              </Text>
            </>
          ) : null}

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={styles.bodyInner}
            onLayout={(e: LayoutChangeEvent) => {
              layoutH.current = e.nativeEvent.layout.height;
              measure();
            }}
            onContentSizeChange={(_w, h) => {
              contentH.current = h;
              measure();
            }}
            onScroll={onScroll}
            scrollEventThrottle={32}
          >
            <Markdown source={body} />
            {reread && chosen ? <Text style={styles.chosen}>{STR.ppYourAnswer.replace("{a}", label(chosen))}</Text> : null}
          </ScrollView>

          {overflow && !atEnd ? (
            <Pressable
              style={styles.more}
              onPress={() => scrollRef.current?.scrollTo({ y: scrollY.current + layoutH.current * 0.8, animated: true })}
              accessibilityRole="button"
            >
              <Text style={styles.moreText}>{STR.ppMoreBelow}</Text>
            </Pressable>
          ) : null}

          {hint ? (
            <View style={styles.hint} accessibilityLiveRegion="polite">
              {hint.map((h) => (
                <Text key={h} style={styles.hintText}>
                  {h}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.foot}>
            {show.attachmentUrl ? (
              <Button title={STR.ppOpenAttachment} variant="ghost" onPress={() => void Linking.openURL(show.attachmentUrl)} />
            ) : null}
            {actions.length > 0 ? (
              <View style={styles.actRow}>
                {actions.map((a, i) => (
                  <Button
                    key={a.id}
                    title={label(a)}
                    variant={i === 0 ? "primary" : "secondary"}
                    loading={busy}
                    onPress={() => void act(a)}
                    style={[styles.actBtn, readUnmet.length > 0 && styles.locked]}
                  />
                ))}
              </View>
            ) : null}
            {actions.length === 0 || reread ? (
              <Button
                title={scrollLeft ? STR.ppScrollDown : timeLeft ? STR.ppCloseIn.replace("{n}", bnNum(timeLeft)) : STR.close}
                variant={actions.length > 0 ? "secondary" : "primary"}
                onPress={tryClose}
                style={unmet.length > 0 && styles.locked}
              />
            ) : null}
            {canSnooze ? (
              <Button
                title={STR.ppSnooze}
                variant="ghost"
                onPress={() => {
                  if (closed.current) return;
                  closed.current = true;
                  onSnooze?.(readMs);
                }}
              />
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    maxHeight: "86%",
    overflow: "hidden",
  },
  strip: { height: 5 },
  toneInfo: { backgroundColor: colors.primaryContainer, color: colors.onPrimaryContainer },
  toneImportant: { backgroundColor: colors.goldContainer, color: colors.onGoldContainer },
  toneUrgent: { backgroundColor: colors.errorContainer, color: colors.onErrorContainer },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space(3), paddingHorizontal: space(4), paddingTop: space(3) },
  headText: { flex: 1, minWidth: 0 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginBottom: space(1) },
  tone: { ...typeScale.caption, paddingHorizontal: space(2), borderRadius: radius.sm, overflow: "hidden" },
  metaText: { ...typeScale.caption, color: colors.textSecondary },
  title: { ...typeScale.sectionTitle, color: colors.textPrimary },
  x: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  xMark: { ...typeScale.body, color: colors.textPrimary, fontWeight: "700" },
  xCount: { ...typeScale.caption, color: colors.textSecondary },
  xRing: { position: "absolute", left: 0, bottom: 0, height: 3, backgroundColor: colors.primary },
  bar: { height: 3, backgroundColor: colors.surfaceAlt, marginHorizontal: space(4), marginTop: space(2), borderRadius: 2, overflow: "hidden" },
  barFill: { height: 3, backgroundColor: colors.primary },
  barAuto: { backgroundColor: colors.info },
  autoNote: { ...typeScale.caption, color: colors.textSecondary, paddingHorizontal: space(4), marginTop: space(1) },
  body: { flexGrow: 0, flexShrink: 1, marginTop: space(2) },
  bodyInner: { paddingHorizontal: space(4), paddingBottom: space(2) },
  chosen: { ...typeScale.body, color: colors.primary, marginTop: space(2) },
  more: {
    alignSelf: "center",
    backgroundColor: colors.goldContainer,
    borderRadius: 999,
    paddingHorizontal: space(3),
    paddingVertical: 2,
    marginTop: space(1),
  },
  moreText: { ...typeScale.caption, color: colors.onGoldContainer, fontWeight: "600" },
  hint: { marginHorizontal: space(4), marginTop: space(2), backgroundColor: colors.errorContainer, borderRadius: radius.sm, padding: space(2), gap: 2 },
  hintText: { ...typeScale.caption, color: colors.onErrorContainer },
  foot: { gap: space(2), paddingHorizontal: space(4), paddingTop: space(3), borderTopWidth: 1, borderTopColor: colors.border, marginTop: space(2) },
  actRow: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  actBtn: { flexGrow: 1, flexBasis: 120 },
  locked: { opacity: 0.55 },
}));
