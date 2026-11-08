/**
 * StudentBanglaNamesScreen (AI-4, D-#1131; PRD P11) — the Office writes each child's name
 * in Bangla. The AI can hide only a name it knows, and teachers write names in Bangla, so
 * the comment checker is switched on only after this list is done. `students:edit`.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { BANGLA_NAME_READINESS, SET_STUDENT_BANGLA_NAME, STUDENT_BANGLA_NAMES_PAGE, type BanglaNameRowT } from "../../graphql/studentBanglaName";
import { Screen, Card, Body, Muted, Field, Button, Notice, Loader, ErrorBanner, Chip, ChipRow } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const PAGE_SIZE = 25;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

function Row({ row, onSaved }: { row: BanglaNameRowT; onSaved: () => void }): React.ReactElement {
  const [, save] = useMutation(SET_STUDENT_BANGLA_NAME);
  const [value, setValue] = React.useState(row.nameBn ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  async function onSave(): Promise<void> {
    setBusy(true);
    setError(null);
    const res = await save({ studentId: row.studentId, nameBn: value });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    setDone(true);
    onSaved();
  }
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{row.name}</Body>
      <Muted>{`${row.placeBn} · ${fill(STR.sbnId, { id: row.schoolId })}`}</Muted>
      <Field label={STR.sbnField} value={value} onChangeText={(t) => { setValue(t); setDone(false); }} placeholder={STR.sbnPlaceholder} />
      {error ? <Notice tone="danger" message={error} /> : null}
      {done ? <Notice tone="ok" message={STR.sbnSaved} /> : null}
      <View style={{ marginTop: space(1) }}>
        <Button title={STR.sbnSave} variant="secondary" onPress={() => void onSave()} loading={busy} disabled={value.trim().length < 2 || value.trim() === (row.nameBn ?? "")} />
      </View>
    </Card>
  );
}

export default function StudentBanglaNamesScreen(): React.ReactElement {
  const [missingOnly, setMissingOnly] = React.useState(true);
  const [page, setPage] = usePageState(missingOnly);
  const [q, refetch] = useQuery({ query: STUDENT_BANGLA_NAMES_PAGE, variables: { page, pageSize: PAGE_SIZE, missingOnly }, requestPolicy: "cache-and-network" });
  const [rq, refetchReady] = useQuery({ query: BANGLA_NAME_READINESS, requestPolicy: "cache-and-network" });
  const data = q.data?.studentBanglaNamesPage;
  const r = rq.data?.banglaNameReadiness;
  // Saving keeps the row on screen (done badge); the counts refresh at once.
  const onSaved = React.useCallback(() => refetchReady({ requestPolicy: "network-only" }), [refetchReady]);

  return (
    <Screen scroll>
      <Notice tone="info" message={STR.sbnIntro} />
      {r ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{fill(STR.sbnProgress, { have: r.withBanglaName, all: r.activeStudents })}</Body>
          <Muted>{r.missingBanglaName > 0 ? fill(STR.sbnLeft, { n: r.missingBanglaName }) : STR.sbnAllDone}</Muted>
        </Card>
      ) : null}
      <ChipRow>
        <Chip label={STR.sbnMissing} selected={missingOnly} onPress={() => setMissingOnly(true)} />
        <Chip label={STR.sbnAll} selected={!missingOnly} onPress={() => setMissingOnly(false)} />
      </ChipRow>
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data ? (
        <>
          {data.rows.length === 0 ? <Muted>{STR.sbnNone}</Muted> : null}
          {data.rows.map((row) => <Row key={`${row.studentId}-${missingOnly}`} row={row} onSaved={onSaved} />)}
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => { setPage(p); refetch({ requestPolicy: "network-only" }); }} />
        </>
      ) : null}
    </Screen>
  );
}
