/**
 * MonthlyPendingWorkScreen — what still has to be finished before a month's reports
 * are complete.
 *
 * Answers one question the console could not: the console says a report is
 * "provisional", this says WHO has to do WHAT for it to stop being provisional. The
 * unsettled predicate is the server's, and it is the same one the coverage percentage
 * uses — a screen that counted differently would leave the office unable to tell which
 * number was wrong.
 *
 * Class tests come first because a test with no results at all is the biggest single
 * hole: it makes a whole section's class-test panel read 0/0.
 */
import React, { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import {
  MONTHLY_PENDING_WORK_QUERY,
  MONTHLY_TEACHER_CHASE_QUERY,
  type TeacherChaseT,
  type PendingGroupT,
  type PendingWorkT,
} from "../../graphql/monthlyReport";
import { Screen, Body, Muted, Card, Select, Button, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { space, useColors } from "../../theme";

/** The last 6 closed months, newest first — the same window the console offers. */
function recentPeriodKeys(now: Date): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: string }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
      <Muted style={{ flex: 1 }}>{label}</Muted>
      <Body style={{ color: tone ?? colors.textPrimary, fontWeight: "700" }}>{bnNum(value)}</Body>
    </View>
  );
}

function GroupList({ title, groups }: { title: string; groups: PendingGroupT[] }): React.ReactElement | null {
  const colors = useColors();
  if (groups.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{title}</Body>
      {groups.map((g) => (
        <View
          key={g.key}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingVertical: 5,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Body style={{ flex: 2 }}>{g.key}</Body>
          <Muted style={{ flex: 1, textAlign: "right" }}>
            {bnNum(g.toCheck)} {STR.mpToCheck}
          </Muted>
          <Muted style={{ flex: 1, textAlign: "right" }}>
            {bnNum(g.notSubmitted)} {STR.mpNotSubmitted}
          </Muted>
        </View>
      ))}
    </Card>
  );
}

function ChaseCard({ c }: { c: TeacherChaseT }): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Body style={{ fontWeight: "700" }}>{c.teacherName}</Body>
      <Muted>
        {c.classTests > 0 ? `${STR.mrClassTest} ${bnNum(c.classTests)} · ` : ""}
        {bnNum(c.toCheck)} {STR.mpToCheck} · {bnNum(c.notSubmitted)} {STR.mpNotSubmitted}
      </Muted>
      {/* A teacher with no number is NAMED, not quietly skipped. */}
      {c.unreachable ? (
        <Muted style={{ color: colors.error }}>{STR.mpNoPhone}</Muted>
      ) : (
        <Button title={STR.mpChaseSend} onPress={() => void Linking.openURL(c.waLink as string)} />
      )}
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Muted style={{ color: colors.primary, marginTop: space(1) }}>
          {open ? STR.mpChaseHide : STR.mpChasePreview}
        </Muted>
      </Pressable>
      {open ? <Muted style={{ marginTop: space(1) }}>{c.messageBn}</Muted> : null}
    </View>
  );
}

export default function MonthlyPendingWorkScreen(): React.ReactElement {
  const colors = useColors();
  const periods = useMemo(() => recentPeriodKeys(new Date()), []);
  const [periodKey, setPeriodKey] = useState<string>(periods[0]);

  const [q, refetch] = useQuery({ query: MONTHLY_PENDING_WORK_QUERY, variables: { periodKey } });
  const [chaseQ] = useQuery({ query: MONTHLY_TEACHER_CHASE_QUERY, variables: { periodKey } });
  const chases = chaseQ.data?.monthlyTeacherChase ?? [];
  const p: PendingWorkT | null = q.data?.monthlyPendingWork ?? null;

  const nothingLeft =
    p != null &&
    p.homeworkItems === 0 &&
    p.assignmentItems === 0 &&
    p.classTests.length === 0;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.mpTitle}</Body>
          <Muted>{STR.mpSub}</Muted>
          <Select
            label={STR.mrMonth}
            value={periodKey}
            options={periods.map((k) => ({ label: bnNum(k), value: k }))}
            onChange={(v) => {
              if (v) setPeriodKey(v);
            }}
            placeholder={STR.mrMonth}
          />
        </Card>

        <QueryGate results={[q]} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {nothingLeft ? (
            <EmptyState message={STR.mpAllClear} />
          ) : p ? (
            <>
              <Card>
                <Muted style={{ fontWeight: "700" }}>{STR.mpBlocking}</Muted>
                <Tally label={`${STR.mrHomework} — ${STR.mpToCheck}`} value={p.homeworkToCheck} tone={colors.warning} />
                <Tally label={`${STR.mrAssignment} — ${STR.mpToCheck}`} value={p.assignmentToCheck} tone={colors.warning} />
                <Tally label={STR.mpAwaiting} value={p.homeworkAwaiting + p.assignmentAwaiting} />
                <Tally label={`${STR.mrClassTest} — ${STR.mpNoResults}`} value={p.classTestsNoResults} tone={colors.error} />
                {p.classTestsUnmarked > 0 ? (
                  <Tally label={`${STR.mrClassTest} — ${STR.mpUnmarked}`} value={p.classTestsUnmarked} tone={colors.error} />
                ) : null}
                {p.classTestsNotSubmitted > 0 ? (
                  <Tally
                    label={`${STR.mrClassTest} — ${STR.mpCtUnsubmitted}`}
                    value={p.classTestsNotSubmitted}
                    tone={colors.error}
                  />
                ) : null}
                {/* Below the line: real, but it holds no report open and belongs to
                    the family, not the teacher. */}
                <Muted style={{ fontWeight: "700", marginTop: space(2) }}>{STR.mpNotBlocking}</Muted>
                <Tally label={STR.mpNotSubmitted} value={p.homeworkNotSubmitted + p.assignmentNotSubmitted} />
              </Card>

              {/* First, because one untouched test blanks a whole section's panel. */}
              {p.classTests.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.mpClassTests}</Body>
                  {p.classTests.map((t) => (
                    <View
                      key={t.ctId}
                      style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}
                    >
                      <Body>
                        {t.sectionLabel} — {hwSubjectLabel(t.subject)}
                      </Body>
                      <Muted>
                        {bnNum(t.dateKey)} — {t.teacherName} — {t.ctId}
                        {t.results === 0
                          ? ` — ${STR.mpNoResults}`
                          : t.unmarked > 0
                            ? ` — ${bnNum(t.unmarked)} ${STR.mpUnmarked}`
                            : ` — ${STR.mpCtUnsubmitted}`}
                      </Muted>
                    </View>
                  ))}
                </Card>
              ) : null}

              {chases.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.mpChaseTitle}</Body>
                  {chases.map((c) => (
                    <ChaseCard key={c.teacherId} c={c} />
                  ))}
                </Card>
              ) : null}

              <GroupList title={STR.mpByTeacher} groups={p.byTeacher} />
              <GroupList title={STR.mpBySection} groups={p.bySection} />

              <Card>
                <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.mpDetails}</Body>
                {p.rows.map((r) => (
                  <View
                    key={`${r.kind}-${r.ref}`}
                    style={{ paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <Body>
                      {r.sectionLabel} — {hwSubjectLabel(r.subject)} — {bnNum(r.dateKey)}
                    </Body>
                    <Muted>
                      {r.teacherName} — {r.ref} — {bnNum(r.toCheck)} {STR.mpToCheck} — {bnNum(r.notSubmitted)}{" "}
                      {STR.mpNotSubmitted}
                    </Muted>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
