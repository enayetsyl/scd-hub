/**
 * RevisionListenersScreen (SR-6, D-#1171) — which teacher hears which Hifz student's
 * Saturday revision. One card per listener with their students (× takes a student away;
 * "শিক্ষার্থী যোগ করুন" gives one to them), and a "কারও কাছে নেই" box for students with no
 * listener. The split is standing: it holds every Saturday until someone changes it.
 * Gated on saturday_revision:assign_listeners (the hub hides the entry; the server re-checks).
 */
import React, { useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  REVISION_LISTENER_BOARD_QUERY,
  SET_REVISION_LISTENER,
  type RevisionListenerStudentT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Chip, Select, Notice, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, hifzLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function RevisionListenersScreen(): React.ReactElement {
  const [q, refetch] = useQuery({ query: REVISION_LISTENER_BOARD_QUERY, requestPolicy: "cache-and-network" });
  const [, setListener] = useMutation(SET_REVISION_LISTENER);
  const [level, setLevel] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const students = q.data?.revisionListenerBoard.students ?? [];
  const listeners = q.data?.revisionListenerBoard.listeners ?? [];
  const levels = useMemo(() => [...new Set(students.map((s) => s.level))], [students]);
  const shown = students.filter((s) => !level || s.level === level);
  const nameOf = useMemo(() => new Map(listeners.map((l) => [l.userId, l.name])), [listeners]);

  const byListener = new Map<string, RevisionListenerStudentT[]>();
  for (const s of shown) {
    if (!s.listenerUserId) continue;
    byListener.set(s.listenerUserId, [...(byListener.get(s.listenerUserId) ?? []), s]);
  }
  // Card order is fixed for the visit (D-#1189): alphabetical when the screen first loads,
  // then a teacher picked or given a student later goes to the END (where the picker is) and
  // stays there — so the card does not jump away and the user need not scroll to find it.
  const order = useRef<string[]>([]);
  const assignedIds = students.flatMap((s) => (s.listenerUserId ? [s.listenerUserId] : []));
  if (order.current.length === 0 && assignedIds.length > 0) {
    order.current = [...new Set(assignedIds)].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "", "bn"));
  }
  for (const id of [...assignedIds, ...extra]) if (!order.current.includes(id)) order.current.push(id);
  // A card emptied with ✕ stays (it is in `extra`) so the cards below it do not shift up.
  const cardIds = order.current.filter((id) => byListener.has(id) || extra.includes(id));
  const unassigned = shown.filter((s) => !s.listenerUserId);
  const teacherOptions = listeners.map((l) => ({ label: l.name, value: l.userId }));

  async function give(studentId: string, listenerUserId: string | null): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await setListener({ studentId, listenerUserId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(STR.revListenerSaved);
    refetch({ requestPolicy: "network-only" });
  }

  const studentLabel = (s: RevisionListenerStudentT) => `${s.studentName} · ${hifzLevelLabel(s.level)}`;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revListenersTitle}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.revListenersHelp}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Chip label={`${STR.revListenerAll} (${bnNum(students.length)})`} selected={level === null} onPress={() => setLevel(null)} />
            {levels.map((l) => (
              <Chip key={l} label={hifzLevelLabel(l)} selected={level === l} onPress={() => setLevel(l)} />
            ))}
          </View>
          {ok ? <Notice message={ok} tone="ok" /> : null}
          {error ? <Notice message={error} tone="danger" /> : null}
        </Card>

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {students.length === 0 ? <EmptyState message={STR.revNoLevels} /> : null}

          {cardIds.map((uid) => {
            const mine = byListener.get(uid) ?? [];
            // Students with no teacher first; those with another teacher after, marked "এখন: <name>".
            const addable = [
              ...shown.filter((s) => !s.listenerUserId),
              ...shown.filter((s) => s.listenerUserId && s.listenerUserId !== uid),
            ];
            return (
              <Card key={uid}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{nameOf.get(uid) ?? "—"}</Body>
                  <Muted>
                    {bnNum(mine.length)} {STR.revListenerStudents}
                  </Muted>
                </View>
                {mine.length === 0 ? <Muted style={{ marginTop: space(1) }}>{STR.revListenerNone}</Muted> : null}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                  {mine.map((s) => (
                    <Chip
                      key={s.studentId}
                      label={`${studentLabel(s)}  ✕ ${STR.revListenerRemove}`}
                      onPress={() => {
                        if (busy) return;
                        setExtra((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
                        void give(s.studentId, null);
                      }}
                    />
                  ))}
                </View>
                {addable.length > 0 ? (
                  <Select
                    label={STR.revListenerAdd}
                    value={null}
                    options={addable.map((s) => ({
                      label: studentLabel(s),
                      value: s.studentId,
                      hint: s.listenerUserId
                        ? `${STR.revListenerNowWith} ${nameOf.get(s.listenerUserId) ?? "—"}`
                        : STR.revListenersUnassigned,
                    }))}
                    onChange={(sid) => void give(sid, uid)}
                    placeholder={STR.revListenerAdd}
                    searchable
                  />
                ) : null}
              </Card>
            );
          })}

          {listeners.some((l) => !cardIds.includes(l.userId)) ? (
            <Card>
              <Select
                label={STR.revListenerPick}
                value={null}
                options={teacherOptions.filter((o) => !cardIds.includes(o.value))}
                onChange={(uid) => setExtra((prev) => [...prev, uid])}
                placeholder={STR.revListenerPick}
                searchable
              />
            </Card>
          ) : null}

          {unassigned.length > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {STR.revListenersUnassigned} ({bnNum(unassigned.length)})
              </Body>
              {unassigned.map((s) => (
                <View key={s.studentId} style={{ marginTop: space(2) }}>
                  <Select
                    label={`${studentLabel(s)} · ${s.groupNameBn}`}
                    value={null}
                    options={teacherOptions}
                    onChange={(uid) => void give(s.studentId, uid)}
                    placeholder={STR.revListenerPick}
                    searchable
                  />
                </View>
              ))}
            </Card>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
