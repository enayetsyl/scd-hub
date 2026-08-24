/**
 * PrintHistoryScreen (D-#362) — "what has already been printed", so the same document
 * never has to be sent to the Office twice.
 *
 * Rows are ONE PER DOCUMENT (the server collapses repeats of the same source for the
 * same class/subject/purpose) ordered class → subject → purpose → newest print, with
 * filter chips on those same three axes. Each row opens the original document and offers
 * a reprint: the earlier job's source and print settings are re-queued for a NEW use
 * date — no re-upload, no re-attaching a link.
 *
 * Scope is server-side: the Office/Principal see every requester's prints, a teacher
 * sees only their own.
 *
 * PQ-7 (owner ask, live testing): the class chips come from the ROSTER — deriving them
 * from the returned rows hid Nursery/KG entirely, because only the class-test path tags a
 * job with a class. Added a teacher filter (Office view) and a printed-on date window,
 * which narrows server-side so it can reach past the page window. And a page cut short by
 * the limit now says so instead of passing a short list off as the whole history.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ROUTINE_SUBJECTS, PRINT_COLOUR_LABELS_EN, PRINT_SIDES_LABELS_EN } from "@scd/shared";
import type { Role } from "@scd/shared";
import {
  PRINT_HISTORY_QUERY,
  REPRINT_PRINT_REQUEST,
  TAG_PRINT_REQUESTS,
  type PrintHistoryRowT,
} from "../../graphql/printing";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import type { PrintStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Button,
  Badge,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
// routineSubjectLabel, not subjectLabel: a print job's subject can be ARABIC/QURAN, which
// the foundation subject labels don't carry (they'd render as the raw code).
import { STR, bnNum, classLevelLabel, routineSubjectLabel, printPurposeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { openPrintSource } from "../../lib/printSource";
import { useFileOpen } from "../../lib/useFileOpen";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<PrintStackParamList, "PrintHistory">;

/** Today as a `YYYY-MM-DD` key — the default use date for a reprint. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Sentinel for "no filter" — an empty string would collide with a real missing class. */
const ANY = "__any__";
/** Sentinel for "jobs with no class". Distinct from ANY: it used to share it, which made
 *  the "no class" chip a second, permanently-lit copy of "all" that filtered nothing. */
const NONE = "__none__";

export default function PrintHistoryScreen({ navigation }: Props): React.ReactElement {
  const { role, user, can } = useAuth();
  const toast = useToast();
  const isOffice = can("roster:manage");

  const [classFilter, setClassFilter] = useState<string>(ANY);
  const [subjectFilter, setSubjectFilter] = useState<string>(ANY);
  const [purposeFilter, setPurposeFilter] = useState<string>(ANY);
  const [teacherFilter, setTeacherFilter] = useState<string>(ANY);
  // PQ-7: the printed-on window. Empty = open-ended; a half-typed date is simply not sent.
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");

  // The open reprint form, keyed by row — only one at a time.
  const [reprintFor, setReprintFor] = useState<string | null>(null);
  // PQ-9 — the open tag form, likewise one at a time.
  const [tagFor, setTagFor] = useState<string | null>(null);
  const [tagClass, setTagClass] = useState<string | null>(null);
  // D-#459: which section within the class — required alongside class+subject for the
  // assignment↔print gap report to match an ASSIGNMENT job tagged after the fact.
  const [tagSection, setTagSection] = useState<string | null>(null);
  const [tagSubject, setTagSubject] = useState<string | null>(null);
  const [useDate, setUseDate] = useState("");
  const [copies, setCopies] = useState("");
  // D-#294: how THIS reprint counts. Carried over from the earlier job, but switchable —
  // a per-class-present job resolves its count from the use day's attendance, so a typed
  // number only reaches the Office once the mode is FIXED.
  const [copiesMode, setCopiesMode] = useState<"FIXED" | "CLASS_PRESENT">("FIXED");
  const [busy, setBusy] = useState(false);

  // The date window is the only filter that goes to the SERVER: it is applied to the
  // jobs BEFORE they are grouped (so "printed in June" is exact), and it is what lets a
  // read reach past the page window once a year's worth of jobs has piled up.
  const datesValid = (!fromKey || ISO_DATE.test(fromKey)) && (!toKey || ISO_DATE.test(toKey));
  const datesInverted = ISO_DATE.test(fromKey) && ISO_DATE.test(toKey) && fromKey > toKey;
  const sendDates = datesValid && !datesInverted;

  // cache-and-network: a reprint moves the job into the REQUESTED bucket and bumps this
  // document's print count, so the cached page is stale the moment we act.
  const [historyQ, refetchHistory] = useQuery({
    query: PRINT_HISTORY_QUERY,
    variables: {
      fromKey: sendDates && ISO_DATE.test(fromKey) ? fromKey : null,
      toKey: sendDates && ISO_DATE.test(toKey) ? toKey : null,
    },
    requestPolicy: "cache-and-network",
  });
  const [, reprint] = useMutation(REPRINT_PRINT_REQUEST);
  const [, tagRequests] = useMutation(TAG_PRINT_REQUESTS);
  const { openingId, runOpen } = useFileOpen();

  // The roster's classes — the class axis has to be complete even for a class nobody has
  // printed for yet (deriving it from the rows dropped Nursery/KG, PQ-7).
  const { selection } = useSectionContext();
  const [{ data: yearsData }] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const academicYearId =
    selection.academicYearId ?? yearsData?.academicYears.find((y) => y.current)?.id ?? null;
  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: academicYearId ?? "" },
    pause: !academicYearId,
  });

  const rows = historyQ.data?.printHistory.rows ?? [];
  const scannedCapped = historyQ.data?.printHistory.scannedCapped ?? false;
  const truncated = historyQ.data?.printHistory.truncated ?? false;
  const totalRows = historyQ.data?.printHistory.totalRows ?? 0;

  // Every roster class, PLUS any class a row names that the roster no longer lists (a job
  // filed against an earlier year's class), PLUS "no class" for the remainder that names
  // one nowhere. Rows are keyed on the row's EFFECTIVE class (PQ-8) — `latest.classId` is
  // set only by the class-test path, so filtering on it showed Nursery empty and Class 1
  // with a single row while the school had printed for both all term.
  const classOptions = useMemo(() => {
    const seen = new Map<string, number | null>();
    for (const c of classData?.classes ?? []) if (c.active) seen.set(c.id, c.level);
    for (const r of rows) if (r.classId) seen.set(r.classId, r.classLevel);
    const out = [...seen.entries()].sort(
      (a, b) => (a[1] ?? Number.MAX_SAFE_INTEGER) - (b[1] ?? Number.MAX_SAFE_INTEGER),
    );
    // "No class" sorts last, matching the row order.
    if (rows.some((r) => !r.classId)) out.push([NONE, null]);
    return out;
  }, [rows, classData]);
  const subjectOptions = useMemo(
    () => [...new Set(rows.map((r) => r.latest.subject).filter((s): s is string => !!s))].sort(),
    [rows],
  );
  const purposeOptions = useMemo(() => [...new Set(rows.map((r) => r.latest.purpose))], [rows]);
  // Requester ids are index-aligned with the names; a group can list several.
  const teacherOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) r.requesterIds.forEach((id, i) => seen.set(id, r.requesterNames[i] ?? "—"));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // A narrowed date window can remove the very option a chip is pinned to; drop such a
  // selection rather than leave an invisible filter hiding every row. Only once the new
  // page has actually landed — mid-fetch the option lists are empty, and resetting off
  // that would wipe the teacher's chips every time they touch a date.
  useEffect(() => {
    if (historyQ.fetching || !historyQ.data) return;
    if (classFilter !== ANY && !classOptions.some(([id]) => id === classFilter)) setClassFilter(ANY);
    if (subjectFilter !== ANY && !subjectOptions.includes(subjectFilter)) setSubjectFilter(ANY);
    if (purposeFilter !== ANY && !purposeOptions.includes(purposeFilter)) setPurposeFilter(ANY);
    if (teacherFilter !== ANY && !teacherOptions.some(([id]) => id === teacherFilter)) setTeacherFilter(ANY);
  }, [
    historyQ.fetching, historyQ.data,
    classOptions, subjectOptions, purposeOptions, teacherOptions,
    classFilter, subjectFilter, purposeFilter, teacherFilter,
  ]);

  const visible = rows.filter(
    (r) =>
      (classFilter === ANY || (r.classId ?? NONE) === classFilter) &&
      (subjectFilter === ANY || r.latest.subject === subjectFilter) &&
      (purposeFilter === ANY || r.latest.purpose === purposeFilter) &&
      (teacherFilter === ANY || r.requesterIds.includes(teacherFilter)),
  );

  // PQ-9 — who may name the class of an untagged row: the Office, or the teacher who
  // filed it. Mirrors the server gate; the server is still the one enforcing it.
  const canTag = (r: PrintHistoryRowT): boolean =>
    isOffice || (!!user && r.requesterIds.includes(user.id));
  // D-#459: also offer the tag form when the class is already set but the SECTION isn't —
  // e.g. an ASSIGNMENT job filed before the section picker existed, or tagged for class
  // only. Without a section it can never match the assignment print-gap report.
  const needsTag = (r: PrintHistoryRowT): boolean => !r.classId || !r.latest.sectionId;

  // D-#459: sections for the currently-picked tag class, same sole-section auto-select
  // UX as NewPrintRequestScreen.
  const tagSelectedClass = (classData?.classes ?? []).find((c) => c.id === tagClass) ?? null;
  const tagActiveSections = tagSelectedClass ? tagSelectedClass.sections.filter((s) => s.active) : [];
  const tagSoleSection = tagActiveSections.length === 1 ? tagActiveSections[0] : null;
  useEffect(() => {
    if (tagSoleSection && tagSection !== tagSoleSection.id) setTagSection(tagSoleSection.id);
  }, [tagSoleSection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function openTag(r: PrintHistoryRowT): void {
    if (tagFor === r.key) {
      setTagFor(null);
      return;
    }
    setTagFor(r.key);
    // Pre-filled from the row's own class if it already has one (only the section is
    // missing), else from the file name where we could read one. Both stay editable.
    setTagClass(r.classId ?? r.suggestedClassId);
    setTagSection(r.latest.sectionId);
    setTagSubject(r.latest.subject ?? r.suggestedSubject);
  }

  async function saveTag(r: PrintHistoryRowT): Promise<void> {
    if (!tagClass) return;
    setBusy(true);
    // The WHOLE group is tagged: the row is a document, and tagging one print of it would
    // move that print into a row of its own.
    const res = await tagRequests({
      ids: r.jobIds,
      classId: tagClass,
      sectionId: tagSection,
      subject: tagSubject,
    });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.prTagOk, "ok");
    setTagFor(null);
    refetchHistory({ requestPolicy: "network-only" });
  }

  function openReprint(r: PrintHistoryRowT): void {
    if (reprintFor === r.key) {
      setReprintFor(null);
      return;
    }
    setReprintFor(r.key);
    // Prefilled from the earlier job — a reprint usually differs only in the date.
    setUseDate(todayKey());
    setCopies(String(r.latest.copies));
    setCopiesMode(r.latest.copiesMode === "CLASS_PRESENT" ? "CLASS_PRESENT" : "FIXED");
  }

  async function sendReprint(r: PrintHistoryRowT): Promise<void> {
    setBusy(true);
    const res = await reprint({
      id: r.latest.id,
      neededByKey: useDate,
      // Under CLASS_PRESENT the count comes from attendance — sending the prefilled
      // number would only look like it was honoured.
      copies: copiesMode === "FIXED" ? Number(copies) : null,
      copiesMode,
    });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.prReprintOk, "ok");
    setReprintFor(null);
    refetchHistory({ requestPolicy: "network-only" });
    // The reprint is now the top job in the queue — take them there to watch it.
    navigation.navigate("PrintHome");
  }

  const reprintValid =
    ISO_DATE.test(useDate) &&
    (copiesMode === "CLASS_PRESENT" || (Number.isInteger(Number(copies)) && Number(copies) >= 1));

  return (
    <Screen scroll>
      <H2>{STR.prHistory}</H2>
      <Muted>{STR.prHistoryHint}</Muted>
      {scannedCapped ? <Notice message={STR.prHistoryCapped} tone="warn" /> : null}
      {/* PQ-7: a page cut short by the limit says so — a short list must never read as
          "this is everything that was ever printed". */}
      {truncated ? <Notice message={STR.prHistoryTruncated} tone="warn" /> : null}
      {datesInverted ? <Notice message={STR.prDatesInverted} tone="danger" /> : null}

      {/* PQ-7 — the printed-on window. Narrows server-side, so it reaches past the page. */}
      <Muted style={{ marginTop: space(3) }}>{STR.prPrintedBetween}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <DateField label={STR.prFromDate} value={fromKey} onChange={setFromKey} />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <DateField label={STR.prToDate} value={toKey} onChange={setToKey} />
        </View>
      </View>
      {fromKey || toKey ? (
        <Button
          title={STR.prClearDates}
          variant="ghost"
          onPress={() => {
            setFromKey("");
            setToKey("");
          }}
        />
      ) : null}

      {/* The three axes the owner asked to browse by: class, subject, then what it is for. */}
      {classOptions.length > 1 ? (
        <>
          <Muted style={{ marginTop: space(3) }}>{STR.prPickClass}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={classFilter === ANY} onPress={() => setClassFilter(ANY)} />
            {classOptions.map(([id, level]) => (
              <Chip
                key={id}
                label={id === NONE || level === null ? STR.prNoClass : classLevelLabel(level)}
                selected={classFilter === id}
                onPress={() => setClassFilter(id)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {subjectOptions.length > 1 ? (
        <>
          <Muted>{STR.hrCoverSubject}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={subjectFilter === ANY} onPress={() => setSubjectFilter(ANY)} />
            {subjectOptions.map((s) => (
              <Chip
                key={s}
                label={routineSubjectLabel(s)}
                selected={subjectFilter === s}
                onPress={() => setSubjectFilter(s)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {purposeOptions.length > 1 ? (
        <>
          <Muted>{STR.prPurpose}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={purposeFilter === ANY} onPress={() => setPurposeFilter(ANY)} />
            {purposeOptions.map((p) => (
              <Chip
                key={p}
                label={printPurposeLabel(p)}
                selected={purposeFilter === p}
                onPress={() => setPurposeFilter(p)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {/* PQ-7 — who printed it. Pointless for a teacher: their scope is already themselves. */}
      {isOffice && teacherOptions.length > 1 ? (
        <>
          <Muted>{STR.prPickTeacher}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={teacherFilter === ANY} onPress={() => setTeacherFilter(ANY)} />
            {teacherOptions.map(([id, name]) => (
              <Chip
                key={id}
                label={name}
                selected={teacherFilter === id}
                onPress={() => setTeacherFilter(id)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {rows.length > 0 ? (
        <Muted style={{ marginTop: space(2) }}>
          {bnNum(visible.length)}
          {visible.length !== totalRows ? ` / ${bnNum(totalRows)}` : ""} {STR.prHistoryCount}
        </Muted>
      ) : null}

      {historyQ.fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : historyQ.error ? (
        <ErrorBanner
          message={friendlyError(historyQ.error)}
          onRetry={() => refetchHistory({ requestPolicy: "network-only" })}
        />
      ) : visible.length === 0 ? (
        <EmptyState message={STR.prHistoryEmpty} />
      ) : (
        visible.map((r) => (
          <Card key={r.key}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "700" }}>{r.latest.title}</Body>
                <Muted>
                  {r.classLevel !== null ? classLevelLabel(r.classLevel) : STR.prNoClass}
                  {r.latest.subject ? ` · ${routineSubjectLabel(r.latest.subject)}` : ""}
                  {` · ${printPurposeLabel(r.latest.purpose)}`}
                </Muted>
                <Muted>
                  {STR.prLastPrinted}: {bnNum(r.lastPrintedAt.slice(0, 10))}
                </Muted>
                <Muted>
                  {bnNum(r.latest.copies)} {STR.prCopiesShort}
                  {" · "}
                  {r.latest.colour === "COLOR" ? PRINT_COLOUR_LABELS_EN.COLOR : PRINT_COLOUR_LABELS_EN.BW}
                  {" · "}
                  {r.latest.sides === "DOUBLE" ? PRINT_SIDES_LABELS_EN.DOUBLE : PRINT_SIDES_LABELS_EN.SINGLE}
                </Muted>
                {/* Who has printed it — meaningful only where the caller sees others' jobs. */}
                {isOffice && r.requesterNames.length > 0 ? (
                  <Muted>
                    {STR.prRequester}: {r.requesterNames.join(", ")}
                  </Muted>
                ) : null}
              </View>
              <Badge text={`${bnNum(r.printCount)} ${STR.prPrintedTimes}`} tone={r.printCount > 1 ? "warn" : "muted"} />
            </View>

            {/* Same open affordances as the queue: one button per attached file, or one
                for a set / plan / link. */}
            {r.latest.sourceType === "UPLOAD" ? (
              <View style={{ gap: space(1), marginTop: space(2) }}>
                {r.latest.files.map((f) => (
                  <View
                    key={f.id}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}
                  >
                    <Muted style={{ flex: 1 }}>📄 {f.name}</Muted>
                    <Button
                      title={STR.prOpen}
                      variant="secondary"
                      loading={openingId === f.id}
                      disabled={!!openingId}
                      onPress={() => runOpen(f.id, () => openStoredFile(f.id))}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              {r.latest.sourceType !== "UPLOAD" ? (
                <Button
                  title={STR.prOpen}
                  variant="secondary"
                  loading={openingId === r.latest.id}
                  disabled={!!openingId}
                  onPress={() =>
                    runOpen(r.latest.id, async () => {
                      if (!(await openPrintSource(r.latest))) toast.show(STR.prOpenPlanHint, "info");
                    })
                  }
                />
              ) : null}
              <Button title={STR.prReprint} onPress={() => openReprint(r)} disabled={busy} />
              {/* PQ-9 / D-#459 — offered while class or section is still missing, and only
                  to someone allowed to say (the Office, or whoever filed it). */}
              {needsTag(r) && canTag(r) ? (
                <Button title={STR.prTag} variant="secondary" onPress={() => openTag(r)} disabled={busy} />
              ) : null}
            </View>

            {/* The tag form: class is required (it is the axis that was missing), subject
                optional. Both arrive pre-filled when the file name gave them away. */}
            {tagFor === r.key ? (
              <View style={{ marginTop: space(2) }}>
                <Muted>{STR.prTagHint}</Muted>
                {r.suggestionEvidence ? (
                  <Muted style={{ marginTop: space(1) }}>
                    {STR.prTagGuess}: {r.suggestionEvidence}
                  </Muted>
                ) : null}
                <Muted style={{ marginTop: space(2) }}>{STR.prPickClass}</Muted>
                <ChipRow>
                  {(classData?.classes ?? [])
                    .filter((c) => c.active)
                    .slice()
                    .sort((a, b) => a.level - b.level)
                    .map((c) => (
                      <Chip
                        key={c.id}
                        label={classLevelLabel(c.level)}
                        selected={tagClass === c.id}
                        onPress={() => {
                          setTagClass(c.id);
                          setTagSection(null); // re-picked below; auto-fills for a single-section class
                        }}
                      />
                    ))}
                </ChipRow>
                {tagClass && tagActiveSections.length > 1 ? (
                  <>
                    <Muted>{STR.section}</Muted>
                    <ChipRow>
                      {tagActiveSections.map((s) => (
                        <Chip
                          key={s.id}
                          label={s.nameBn || s.code}
                          selected={tagSection === s.id}
                          onPress={() => setTagSection(tagSection === s.id ? null : s.id)}
                        />
                      ))}
                    </ChipRow>
                  </>
                ) : null}
                <Muted>{STR.prTagSubjectOptional}</Muted>
                <ChipRow>
                  {ROUTINE_SUBJECTS.map((s) => (
                    <Chip
                      key={s}
                      label={routineSubjectLabel(s)}
                      selected={tagSubject === s}
                      // Tapping the chosen subject again clears it — subject is optional,
                      // so there has to be a way back to "not saying".
                      onPress={() => setTagSubject(tagSubject === s ? null : s)}
                    />
                  ))}
                </ChipRow>
                <Button
                  title={STR.prTagSave}
                  loading={busy}
                  disabled={busy || !tagClass}
                  onPress={() => saveTag(r)}
                />
                {!tagClass ? <Muted>{STR.prTagNeedClass}</Muted> : null}
              </View>
            ) : null}

            {/* The reprint form: everything carries over from the earlier job, so only the
                use date (and optionally the count) is asked for. */}
            {reprintFor === r.key ? (
              <View style={{ marginTop: space(2) }}>
                <DateField label={STR.prUseDate} value={useDate} onChange={setUseDate} helper={STR.hrDateHint} />
                {/* D-#294: only a job that counted per class present offers the choice —
                    for it, a typed number is honoured ONLY under "type a number". */}
                {r.latest.copiesMode === "CLASS_PRESENT" ? (
                  <ChipRow>
                    <Chip
                      label={STR.prCopiesFixed}
                      selected={copiesMode === "FIXED"}
                      onPress={() => setCopiesMode("FIXED")}
                    />
                    <Chip
                      label={
                        STR.prCopiesClass +
                        (r.latest.copiesClassLevel !== null
                          ? ` (${classLevelLabel(r.latest.copiesClassLevel)})`
                          : "")
                      }
                      selected={copiesMode === "CLASS_PRESENT"}
                      onPress={() => setCopiesMode("CLASS_PRESENT")}
                    />
                  </ChipRow>
                ) : null}
                {copiesMode === "CLASS_PRESENT" ? (
                  <Muted style={{ marginTop: space(1) }}>{STR.prReprintPerPresent}</Muted>
                ) : (
                  <Field label={STR.prCopies} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
                )}
                <Button
                  title={STR.prSend}
                  loading={busy}
                  disabled={busy || !reprintValid}
                  onPress={() => sendReprint(r)}
                />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
