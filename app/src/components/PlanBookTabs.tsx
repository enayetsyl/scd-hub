/**
 * PlanBookTabs — "📄 পরিকল্পনা | 📖 বই" beside a lesson plan (.claude/plans/plan-book-tab.md).
 * The screen passes its own plan view as children; this component adds the book pane. Both
 * panes stay mounted (the hidden one is display:none) and each scrolls itself, so each keeps
 * its place. The book query waits until the book is first shown. The last tab and the
 * side-by-side choice (wide screens only) are remembered per device.
 */
import React from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useQuery, type CombinedError } from "urql";
import { PLAN_BOOK_CHAPTER, type PlanBookChapterT } from "../graphql/planBook";
import { Chip, ChipRow, ErrorBanner, Loader, Muted, Notice, Select } from "./ui";
import Markdown from "./Markdown";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { getItem, setItem } from "../lib/storage";
import { makeStyles, space, typeScale } from "../theme";

const TAB_KEY = "planBook.tab";
const SIDE_KEY = "planBook.side";
const SIDE_MIN_WIDTH = 1000;

/** "অধ্যায় ১: …" / "পাঠ ৩ — …" / "Unit 2: …" → just the leading label; null when there is none. */
export function chapterShortLabel(title: string | null | undefined): string | null {
  const m = /^\s*(অধ্যায়|পাঠ|ইউনিট|Unit|Lesson|Chapter)\s*[0-9০-৯]+/i.exec(title ?? "");
  return m ? m[0].trim() : null;
}

function BookPane({
  b,
  fetching,
  error,
  chapterKey,
  onPick,
  onRetry,
}: {
  b: PlanBookChapterT | null;
  fetching: boolean;
  error: CombinedError | undefined;
  chapterKey: string | null;
  onPick: (k: string) => void;
  onRetry: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const [noteOpen, setNoteOpen] = React.useState(false);

  React.useEffect(() => setNoteOpen(false), [b?.chapterKey]);

  if (!b) {
    if (error) return <ErrorBanner message={friendlyError(error)} onRetry={() => onRetry()} />;
    return <Loader label={STR.loading} />;
  }
  if (!b.available) return <Notice message={b.reason || STR.pbNoBook} tone="warn" />;

  const options = b.chapters.map((c) => ({ label: c.title, value: c.key }));
  return (
    <View>
      {b.chapterKey === null && chapterKey === null ? <Notice message={STR.pbChapterMissing} tone="warn" /> : null}
      <Select
        label={STR.pbPickChapter}
        value={b.chapterKey ?? chapterKey}
        options={options}
        onChange={onPick}
        placeholder={STR.pbPickChapter}
        searchable
      />
      {error ? <ErrorBanner message={friendlyError(error)} onRetry={() => onRetry()} /> : null}
      {fetching ? <Loader /> : null}
      {b.bookTitle ? (
        <Muted style={{ marginTop: space(2) }}>
          {`${b.bookTitle} · ${STR.pbVersionLine} ${b.versionLabel ?? ""} (${b.released ? STR.pbPrinted : STR.pbFinal})`}
        </Muted>
      ) : null}
      {b.chapterKey ? (
        <View style={{ marginTop: space(2) }}>
          {b.childText ? <Markdown source={b.childText} images /> : <Notice message={STR.pbNoText} tone="warn" />}
          {b.teacherNote && !b.anchorMissing ? (
            <View style={styles.fold}>
              <Pressable onPress={() => setNoteOpen((o) => !o)} accessibilityRole="button" style={styles.foldHead}>
                <Text style={styles.foldTitle}>
                  {noteOpen ? "▾ " : "▸ "}
                  {STR.pbTeacherNote}
                </Text>
              </Pressable>
              {noteOpen ? (
                <View style={styles.foldBody}>
                  <Markdown source={b.teacherNote} images />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function PlanBookTabs({ artifactId, children }: { artifactId: string; children: React.ReactNode }): React.ReactElement {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= SIDE_MIN_WIDTH;
  const [tab, setTab] = React.useState<"plan" | "book">("plan");
  const [side, setSide] = React.useState(false);
  const [opened, setOpened] = React.useState(false);
  const [chapterKey, setChapterKey] = React.useState<string | null>(null);
  const sideOn0 = wide && side;
  const [{ data, fetching, error }, refetch] = useQuery({
    query: PLAN_BOOK_CHAPTER,
    variables: { artifactId, chapterKey },
    pause: !(opened || sideOn0),
  });
  const lastRef = React.useRef<PlanBookChapterT | null>(null);
  if (data?.planBookChapter) lastRef.current = data.planBookChapter;
  const b = data?.planBookChapter ?? lastRef.current;
  const short = chapterShortLabel(b?.title);

  React.useEffect(() => {
    let off = false;
    void (async () => {
      try {
        const [t, s] = await Promise.all([getItem(TAB_KEY), getItem(SIDE_KEY)]);
        if (off) return;
        if (t === "book") {
          setTab("book");
          setOpened(true);
        }
        if (s === "1") setSide(true);
      } catch {
        /* storage unavailable — start on the plan */
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  const sideOn = wide && side;
  const showPlan = sideOn || tab === "plan";
  const showBook = sideOn || tab === "book";

  function pick(t: "plan" | "book"): void {
    setTab(t);
    if (t === "book") setOpened(true);
    void setItem(TAB_KEY, t).catch(() => undefined);
  }
  function toggleSide(): void {
    const next = !side;
    setSide(next);
    if (next) setOpened(true);
    void setItem(SIDE_KEY, next ? "1" : "0").catch(() => undefined);
  }

  const bookLabel = short ? `${STR.pbTabBook} · ${short}` : STR.pbTabBook;
  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <ChipRow>
          {sideOn ? null : (
            <>
              <Chip label={STR.pbTabPlan} selected={tab === "plan"} onPress={() => pick("plan")} />
              <Chip label={bookLabel} selected={tab === "book"} onPress={() => pick("book")} />
            </>
          )}
          {wide ? <Chip label={sideOn ? STR.pbSideBySideOff : STR.pbSideBySide} selected={sideOn} onPress={toggleSide} /> : null}
        </ChipRow>
      </View>
      <View style={styles.panes}>
        <ScrollView
          style={[styles.pane, showPlan ? null : styles.hidden, sideOn ? styles.paneGap : null]}
          contentContainerStyle={styles.paneBody}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        <ScrollView style={[styles.pane, showBook ? null : styles.hidden]} contentContainerStyle={styles.paneBody}>
          <BookPane
            b={b}
            fetching={fetching}
            error={error}
            chapterKey={chapterKey}
            onPick={setChapterKey}
            onRetry={() => refetch({ requestPolicy: "network-only" })}
          />
        </ScrollView>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1 },
  bar: { paddingBottom: space(2) },
  panes: { flex: 1, flexDirection: "row" as const },
  pane: { flex: 1, minWidth: 0 },
  paneGap: { marginRight: space(4) },
  hidden: { display: "none" as const },
  paneBody: { paddingBottom: space(8) },
  fold: { marginTop: space(3), borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: "hidden" as const },
  foldHead: { padding: space(3), backgroundColor: colors.surfaceAlt },
  foldTitle: { ...typeScale.bodyStrong, color: colors.textPrimary, flexShrink: 1 },
  foldBody: { padding: space(3) },
}));
