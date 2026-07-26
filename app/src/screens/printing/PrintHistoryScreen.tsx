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
 * sees only their own. The chips are derived from the rows actually returned, so a
 * teacher's filters only ever offer their own classes/subjects.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { roleHasPermission, PRINT_COLOUR_LABELS_EN, PRINT_SIDES_LABELS_EN } from "@scd/shared";
import type { Role } from "@scd/shared";
import {
  PRINT_HISTORY_QUERY,
  REPRINT_PRINT_REQUEST,
  type PrintHistoryRowT,
} from "../../graphql/printing";
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
import { STR, bnNum, classLevelLabel, subjectLabel, printPurposeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openStoredFile } from "../../lib/files";
import { openPrintSource } from "../../lib/printSource";
import { useFileOpen } from "../../lib/useFileOpen";
import { useAuth } from "../../auth/AuthContext";
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

export default function PrintHistoryScreen({ navigation }: Props): React.ReactElement {
  const { role } = useAuth();
  const toast = useToast();
  const isOffice = !!role && roleHasPermission(role as Role, "roster:manage");

  const [classFilter, setClassFilter] = useState<string>(ANY);
  const [subjectFilter, setSubjectFilter] = useState<string>(ANY);
  const [purposeFilter, setPurposeFilter] = useState<string>(ANY);

  // The open reprint form, keyed by row — only one at a time.
  const [reprintFor, setReprintFor] = useState<string | null>(null);
  const [useDate, setUseDate] = useState("");
  const [copies, setCopies] = useState("");
  const [busy, setBusy] = useState(false);

  // cache-and-network: a reprint moves the job into the REQUESTED bucket and bumps this
  // document's print count, so the cached page is stale the moment we act.
  const [historyQ, refetchHistory] = useQuery({
    query: PRINT_HISTORY_QUERY,
    variables: {},
    requestPolicy: "cache-and-network",
  });
  const [, reprint] = useMutation(REPRINT_PRINT_REQUEST);
  const { openingId, runOpen } = useFileOpen();

  const rows = historyQ.data?.printHistory.rows ?? [];
  const scannedCapped = historyQ.data?.printHistory.scannedCapped ?? false;

  // Filter options come from the rows themselves: whatever HAS been printed is what is
  // worth filtering by, and it keeps a teacher's chips scoped to their own prints
  // without a second round trip for class/subject master lists.
  const classOptions = useMemo(() => {
    const seen = new Map<string, number | null>();
    for (const r of rows) seen.set(r.latest.classId ?? ANY, r.latest.classLevel);
    return [...seen.entries()].sort(
      (a, b) => (a[1] ?? Number.MAX_SAFE_INTEGER) - (b[1] ?? Number.MAX_SAFE_INTEGER),
    );
  }, [rows]);
  const subjectOptions = useMemo(
    () => [...new Set(rows.map((r) => r.latest.subject).filter((s): s is string => !!s))].sort(),
    [rows],
  );
  const purposeOptions = useMemo(() => [...new Set(rows.map((r) => r.latest.purpose))], [rows]);

  const visible = rows.filter(
    (r) =>
      (classFilter === ANY || (r.latest.classId ?? ANY) === classFilter) &&
      (subjectFilter === ANY || r.latest.subject === subjectFilter) &&
      (purposeFilter === ANY || r.latest.purpose === purposeFilter),
  );

  function openReprint(r: PrintHistoryRowT): void {
    if (reprintFor === r.key) {
      setReprintFor(null);
      return;
    }
    setReprintFor(r.key);
    // Prefilled from the earlier job — a reprint usually differs only in the date.
    setUseDate(todayKey());
    setCopies(String(r.latest.copies));
  }

  async function sendReprint(r: PrintHistoryRowT): Promise<void> {
    setBusy(true);
    const res = await reprint({
      id: r.latest.id,
      neededByKey: useDate,
      copies: Number(copies),
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

  const reprintValid = ISO_DATE.test(useDate) && Number.isInteger(Number(copies)) && Number(copies) >= 1;

  return (
    <Screen scroll>
      <H2>{STR.prHistory}</H2>
      <Muted>{STR.prHistoryHint}</Muted>
      {scannedCapped ? <Notice message={STR.prHistoryCapped} tone="warn" /> : null}

      {/* The three axes the owner asked to browse by: class, subject, then what it is for. */}
      {classOptions.length > 1 ? (
        <>
          <Muted style={{ marginTop: space(3) }}>{STR.prPickClass}</Muted>
          <ChipRow>
            <Chip label={STR.all} selected={classFilter === ANY} onPress={() => setClassFilter(ANY)} />
            {classOptions.map(([id, level]) => (
              <Chip
                key={id}
                label={level !== null ? classLevelLabel(level) : STR.prNoClass}
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
                label={subjectLabel(s)}
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
                  {r.latest.classLevel !== null ? classLevelLabel(r.latest.classLevel) : STR.prNoClass}
                  {r.latest.subject ? ` · ${subjectLabel(r.latest.subject)}` : ""}
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
            </View>

            {/* The reprint form: everything carries over from the earlier job, so only the
                use date (and optionally the count) is asked for. */}
            {reprintFor === r.key ? (
              <View style={{ marginTop: space(2) }}>
                <DateField label={STR.prUseDate} value={useDate} onChange={setUseDate} helper={STR.hrDateHint} />
                <Field label={STR.prCopies} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
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
