/**
 * UnissuedHomeworkCard (HW-VOID, D-#741) — homework declared with 0 questions, which
 * confirm never issues, so it sits on the class's day forever. Typically a class note
 * a teacher filed as homework by mistake. Lists the last 30 days, school-wide, with a
 * মুছে ফেলুন per row.
 *
 * For `homework:void` holders only (Principal + Office). The Office has no Homework
 * tab (no tracker permission, D-#554), so Today is the one place it can see these.
 * Rendered on AdminTodayScreen (where both roles land, D-#316) and on TodayScreen for
 * a per-user grant. Self-contained; renders nothing while loading, when empty, on error.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { UNISSUED_HOMEWORK, VOID_HOMEWORK_ITEM } from "../graphql/operations";
import { Badge, Body, Button, Card, Muted, Notice, wrapRowText } from "./ui";
import { STR, bnNum, hwSubjectLabel, isoDateLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useConfirm } from "../state/ConfirmContext";
import { useToast } from "../state/ToastContext";
import { space } from "../theme";

export function UnissuedHomeworkCard(): React.ReactElement | null {
  const [q, refetch] = useQuery({ query: UNISSUED_HOMEWORK, variables: {}, requestPolicy: "cache-and-network" });
  const [, voidItem] = useMutation(VOID_HOMEWORK_ITEM);
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const rows = q.data?.unissuedHomework ?? [];
  if (q.error || rows.length === 0) return null;

  async function onDelete(itemId: string): Promise<void> {
    if (busyId) return;
    if (!(await confirmAction({ title: STR.hwDeleteAction, message: STR.hwVoidConfirm, confirmLabel: STR.hwDeleteAction }))) return;
    setErr(null);
    setBusyId(itemId);
    const res = await voidItem({ itemId });
    setBusyId(null);
    if (res.error || !res.data?.voidHomeworkItem) {
      setErr(friendlyError(res.error));
      return;
    }
    toast.show(STR.hwDeleted, "ok");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700", flex: 1 }}>📒 {STR.hwVoidCardTitle}</Body>
        <Badge text={bnNum(rows.length)} tone="warn" />
      </View>
      <Muted style={{ marginTop: 2 }}>{STR.hwVoidCardHint}</Muted>
      {err ? <Notice message={err} tone="danger" /> : null}
      {rows.map((r) => (
        <View
          key={r.itemId}
          style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(3) }}
        >
          <View style={wrapRowText}>
            <Body numberOfLines={1}>
              {r.className}
              {r.sectionName ? ` (${r.sectionName})` : ""} · {hwSubjectLabel(r.subject)}
            </Body>
            <Muted>
              {isoDateLabel(r.dateKey)}
              {r.declaredByName ? ` · ${r.declaredByName}` : ""} · {bnNum(r.qCount)} {STR.questionsWord}
            </Muted>
            {r.description ? <Muted>📝 {r.description}</Muted> : null}
          </View>
          <Button
            title={STR.hwDeleteAction}
            variant="danger"
            loading={busyId === r.itemId}
            disabled={!!busyId}
            onPress={() => void onDelete(r.itemId)}
          />
        </View>
      ))}
    </Card>
  );
}
