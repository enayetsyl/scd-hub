/**
 * PersonActivityScreen (AL-1, D-#645) — "what did this person do, and when".
 *
 * The audit log answers that question for the whole school in one newest-first
 * stream; this answers it for ONE named person, over a date window, with the
 * homework and assignment passes the audit log never carried folded in beside
 * the audit events (see `ActivityService`).
 *
 * Three shapes worth keeping straight:
 * (1) It is RANGE-driven, not scroll-driven. The day strip shows where the work
 *     is before the reader commits to a window, and `truncated` says out loud
 *     when the window is hiding rows — a partial list presented as a complete
 *     one is the failure mode that matters on a screen people are judged by.
 * (2) A tracker pass is ONE row with a count, not thirty rows. "২৮ জন
 *     শিক্ষার্থী" is the fact; the thirty records are its implementation.
 * (3) A View-as row (D-#638) is shown with a warning chip, never silently
 *     attributed to the account it was performed through.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import {
  ACTIVITY_GROUPS_QUERY,
  ACTIVITY_PEOPLE_QUERY,
  ACTIVITY_PERSON_QUERY,
  ACTIVITY_ROW_DETAIL_QUERY,
  PERSON_ACTIVITY_DAYS_QUERY,
  PERSON_ACTIVITY_QUERY,
  type ActivityRowT,
} from "../../graphql/activity";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Chip,
  ChipRow,
  Field,
  Select,
  Divider,
  EmptyState,
  Loader,
  Notice,
} from "../../components/ui";
import { DateField } from "../../components/DateField";
import { QueryGate } from "../../components/QueryGate";
import {
  STR,
  bnNum,
  classLevelLabel,
  dhakaDateKey,
  fullDateLabel,
  hwSubjectLabel,
  isoDateLabel,
  isoTimeLabel,
  getActiveLang,
  roleViewLabel,
} from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "PersonActivity">;

const ROW_LIMIT = 500;

/** N days back from today, as a Dhaka "YYYY-MM-DD" key. */
function daysAgoKey(n: number): string {
  return dhakaDateKey(new Date(Date.now() - n * 86_400_000));
}

function sourceLabel(source: string): string {
  if (source === "HOMEWORK") return STR.actSourceHOMEWORK;
  if (source === "ASSIGNMENT") return STR.actSourceASSIGNMENT;
  return STR.actSourceAUDIT;
}

function sourceTone(source: string): "info" | "brand" | "muted" {
  if (source === "HOMEWORK") return "info";
  if (source === "ASSIGNMENT") return "brand";
  return "muted";
}

/** `{"a":1,"b":"x"}` → ["a: 1", "b: x"], one line per key so a long meta block
 *  stays readable instead of becoming one unbroken sentence. */
function metaLines(metaJson: string | null): string[] {
  if (!metaJson) return [];
  try {
    const m = JSON.parse(metaJson) as Record<string, unknown>;
    return Object.entries(m).map(
      ([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`,
    );
  } catch {
    return [metaJson];
  }
}

/** One timeline row. Its own component because the expand is a LAZY query —
 *  a 500-row window would otherwise fetch every student list nobody opened. */
function ActivityRowCard({
  row,
  personId,
  lang,
}: {
  row: ActivityRowT;
  personId: string;
  lang: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [detailQ] = useQuery({
    query: ACTIVITY_ROW_DETAIL_QUERY,
    variables: { personId, rowId: row.id },
    pause: !open,
  });
  const detail = detailQ.data?.activityRowDetail ?? null;

  // "তৃতীয় শ্রেণি · ইংরেজি · শাখা ক" — the address of the work, from the item.
  const place = [
    row.classLevel != null ? classLevelLabel(row.classLevel) : null,
    row.subject ? hwSubjectLabel(row.subject) : null,
    row.sectionName,
  ]
    .filter(Boolean)
    .join(" · ");

  // A pass spread over time is worth showing as a span; one instant is not.
  const span =
    row.firstAt && row.firstAt !== row.at
      ? `${isoTimeLabel(row.firstAt)}–${isoTimeLabel(row.at)}`
      : isoTimeLabel(row.at);

  const metaRows = detail?.metaJson ? metaLines(detail.metaJson) : metaLines(row.metaJson);

  return (
    <Card onPress={() => setOpen((v) => !v)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Muted>{span}</Muted>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>
          {lang === "en" ? row.labelEn : row.labelBn}
        </Body>
        <Badge text={sourceLabel(row.source)} tone={sourceTone(row.source)} />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space(2),
          marginTop: space(1),
          flexWrap: "wrap",
        }}
      >
        {row.count > 1 ? <Badge text={`${bnNum(row.count)} ${STR.actStudents}`} tone="ok" /> : null}
        {place !== "" ? <Body style={{ flexShrink: 1 }}>{place}</Body> : null}
        {row.targetLabel ? <Muted>{row.targetLabel}</Muted> : null}
        {row.targetLabel == null && row.targetKind ? <Muted>→ {row.targetKind}</Muted> : null}
        {row.viaViewAs ? <Badge text={STR.actViaViewAs} tone="warn" /> : null}
      </View>

      {!open ? (
        <Muted style={{ marginTop: space(1) }}>{STR.actTapForDetails}</Muted>
      ) : detailQ.fetching && detail == null ? (
        <Loader label={STR.loading} />
      ) : (
        <View style={{ marginTop: space(2) }}>
          <Divider />
          {detail?.description ? (
            <Body style={{ marginTop: space(1) }}>{detail.description}</Body>
          ) : null}
          {detail?.itemDate ? (
            <Muted>
              {STR.actItemDate}: {isoDateLabel(detail.itemDate)}
              {detail.dueDate ? ` · ${STR.actDueDate}: ${isoDateLabel(detail.dueDate)}` : ""}
            </Muted>
          ) : null}
          {detail?.targetLabel ? (
            <Muted>
              {detail.targetKind ?? ""}: {detail.targetLabel}
            </Muted>
          ) : null}
          {metaRows.map((l) => (
            <Muted key={l}>{l}</Muted>
          ))}

          {detail && detail.students.length > 0 ? (
            <View style={{ marginTop: space(2) }}>
              <Muted>{STR.actStudentList}</Muted>
              {detail.students.map((st) => (
                <View
                  key={st.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}
                >
                  <Muted>{isoTimeLabel(st.at)}</Muted>
                  <Body style={{ flexShrink: 1 }}>{st.name}</Body>
                  {st.rollNumber ? <Muted>#{bnNum(st.rollNumber)}</Muted> : null}
                </View>
              ))}
              {detail.studentsTruncated ? <Muted>{STR.actStudentsTruncated}</Muted> : null}
            </View>
          ) : null}

          {detail != null &&
          detail.students.length === 0 &&
          metaRows.length === 0 &&
          !detail.description &&
          !detail.targetLabel ? (
            <Muted style={{ marginTop: space(1) }}>{STR.actNoDetail}</Muted>
          ) : null}
        </View>
      )}
    </Card>
  );
}

export default function PersonActivityScreen({ route }: Props): React.ReactElement {
  const preselected = route.params?.personId ?? null;
  const [personId, setPersonId] = useState<string | null>(preselected);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(daysAgoKey(6));
  const [to, setTo] = useState(dhakaDateKey());
  const [group, setGroup] = useState("");
  const [source, setSource] = useState("");

  const lang = getActiveLang();

  const [peopleQ, refetchPeople] = useQuery({
    query: ACTIVITY_PEOPLE_QUERY,
    variables: { search: search.trim() === "" ? null : search.trim(), limit: 40 },
    pause: personId != null,
  });
  const [personQ] = useQuery({
    query: ACTIVITY_PERSON_QUERY,
    variables: { personId: personId ?? "" },
    pause: personId == null,
  });
  const [groupsQ] = useQuery({ query: ACTIVITY_GROUPS_QUERY, pause: personId == null });
  const [feedQ, refetchFeed] = useQuery({
    query: PERSON_ACTIVITY_QUERY,
    variables: {
      personId: personId ?? "",
      from,
      to,
      group: group === "" ? null : group,
      source: source === "" ? null : source,
      limit: ROW_LIMIT,
    },
    pause: personId == null,
  });
  const [daysQ] = useQuery({
    query: PERSON_ACTIVITY_DAYS_QUERY,
    variables: { personId: personId ?? "", from, to },
    pause: personId == null,
  });

  const person = personQ.data?.activityPerson ?? null;
  const rows = useMemo(() => feedQ.data?.personActivity.rows ?? [], [feedQ.data]);
  const truncated = feedQ.data?.personActivity.truncated ?? false;
  const days = daysQ.data?.personActivityDays ?? [];
  const totalActions = days.reduce((n, d) => n + d.total, 0);

  // Group the flat newest-first feed into day blocks, preserving order.
  const blocks = useMemo(() => {
    const out: { day: string; rows: ActivityRowT[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) last.rows.push(r);
      else out.push({ day: r.day, rows: [r] });
    }
    return out;
  }, [rows]);

  const groupOptions = useMemo(() => {
    const gs = groupsQ.data?.activityGroups ?? [];
    return [
      { label: STR.all, value: "" },
      ...gs.map((g) => ({ label: lang === "en" ? g.labelEn : g.labelBn, value: g.value })),
    ];
  }, [groupsQ.data, lang]);

  // ---- person picker -------------------------------------------------------
  if (personId == null) {
    const people = peopleQ.data?.activityPeople ?? [];
    return (
      <Screen scroll>
        <H2>{STR.actTitle}</H2>
        <Muted>{STR.actSubtitle}</Muted>
        <Notice message={STR.actHint} tone="info" />
        <Field label={STR.actSearchPerson} value={search} onChangeText={setSearch} />
        <QueryGate
          result={peopleQ}
          onRetry={() => refetchPeople({ requestPolicy: "network-only" })}
          isEmpty={people.length === 0}
          empty={<EmptyState message={STR.actNoPeople} />}
        >
          <>
            {people.map((p) => (
              <Card key={p.id} onPress={() => setPersonId(p.id)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{p.name}</Body>
                  <Badge text={roleViewLabel(p.role)} tone={p.kind === "STAFF" ? "info" : "muted"} />
                  {!p.active ? <Badge text={STR.actInactive} tone="warn" /> : null}
                </View>
              </Card>
            ))}
          </>
        </QueryGate>
      </Screen>
    );
  }

  // ---- one person's timeline ----------------------------------------------
  return (
    <Screen scroll>
      <H2>{STR.actTitle}</H2>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Body style={{ fontWeight: "700", flexShrink: 1 }}>{person?.name ?? "—"}</Body>
          {person ? <Badge text={roleViewLabel(person.role)} tone="info" /> : null}
          {person && !person.active ? <Badge text={STR.actInactive} tone="warn" /> : null}
        </View>
        <Muted>
          {STR.actTotal}: {bnNum(totalActions)} · {STR.actDaysActive}: {bnNum(days.length)}
        </Muted>
        <Button
          title={STR.actChange}
          variant="secondary"
          onPress={() => setPersonId(null)}
        />
      </Card>

      <ChipRow>
        <Chip
          label={STR.actRange7}
          selected={from === daysAgoKey(6) && to === dhakaDateKey()}
          onPress={() => {
            setFrom(daysAgoKey(6));
            setTo(dhakaDateKey());
          }}
        />
        <Chip
          label={STR.actRange30}
          selected={from === daysAgoKey(29) && to === dhakaDateKey()}
          onPress={() => {
            setFrom(daysAgoKey(29));
            setTo(dhakaDateKey());
          }}
        />
        <Chip
          label={STR.actRangeMonth}
          selected={from === `${dhakaDateKey().slice(0, 7)}-01` && to === dhakaDateKey()}
          onPress={() => {
            setFrom(`${dhakaDateKey().slice(0, 7)}-01`);
            setTo(dhakaDateKey());
          }}
        />
      </ChipRow>

      <View style={{ flexDirection: "row", gap: space(3) }}>
        <View style={{ flex: 1 }}>
          <DateField label={STR.actFrom} value={from} onChange={setFrom} max={to} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={STR.actTo} value={to} onChange={setTo} min={from} />
        </View>
      </View>

      <Select
        label={STR.actGroup}
        value={group === "" ? null : group}
        options={groupOptions}
        onChange={setGroup}
        placeholder={STR.all}
        searchable
      />
      <Select
        label={STR.actSource}
        value={source === "" ? null : source}
        options={[
          { label: STR.all, value: "" },
          { label: STR.actSourceAUDIT, value: "AUDIT" },
          { label: STR.actSourceHOMEWORK, value: "HOMEWORK" },
          { label: STR.actSourceASSIGNMENT, value: "ASSIGNMENT" },
        ]}
        onChange={setSource}
        placeholder={STR.all}
      />

      {truncated ? <Notice message={STR.actTruncated} tone="warn" /> : null}

      <QueryGate
        result={feedQ}
        onRetry={() => refetchFeed({ requestPolicy: "network-only" })}
        isEmpty={rows.length === 0}
        empty={<EmptyState message={`${STR.actNoRows} — ${STR.actNoRowsHint}`} />}
      >
        <>
          {blocks.map((b) => (
            <View key={b.day} style={{ marginTop: space(3) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{fullDateLabel(b.day)}</Body>
                <Badge text={bnNum(b.rows.length)} tone="muted" />
              </View>
              <Divider />
              {b.rows.map((r) => (
                <ActivityRowCard key={r.id} row={r} personId={personId} lang={lang} />
              ))}
            </View>
          ))}
        </>
      </QueryGate>
    </Screen>
  );
}
