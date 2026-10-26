/**
 * Who saw it, who read it, who answered (D-#855, PRD §8.2) — one pop-up notice's report.
 *
 * Counts are over the people who CAN receive a pop-up; guardians with no app login are
 * counted separately and listed with a wa.me link (ADR-003), because a pop-up will never
 * reach them. The answer bar labels every segment with its number (never colour alone),
 * the class breakdown shows where to chase, and the per-person list filters by progress.
 *
 * Follow-ups (popup_notice:follow_up): show again to everyone not done, add people who
 * match the audience now. Fix the words, withdraw or copy: either send action.
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ADD_POPUP_MATCHES,
  DUPLICATE_POPUP_NOTICE,
  POPUP_NOTICE,
  POPUP_NOTICE_REPORT,
  POPUP_RECIPIENTS_PAGE,
  REMIND_POPUP_NOTICE,
  WITHDRAW_POPUP_NOTICE,
  type PopupRecipientRowT,
} from "../../graphql/popupNotice";
import { Badge, Body, Button, Card, Chip, ChipRow, ErrorBanner, Loader, Muted, Notice, Screen } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, bnNum, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import type { PopupStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";
import { statusBadge } from "./PopupNoticeListScreen";

type Props = NativeStackScreenProps<PopupStackParamList, "PopupReport">;

const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0);

function personState(r: PopupRecipientRowT): { text: string; tone: "ok" | "warn" | "danger" | "muted" | "info" } {
  if (!r.reachable) return { text: STR.ppNoLogin, tone: "muted" };
  if (r.state === "ACTED") return { text: r.choiceLabel ? STR.ppAnswered.replace("{a}", r.choiceLabel) : STR.ppStateActed, tone: "ok" };
  if (r.done) return { text: r.state === "READ" ? STR.ppStateRead : STR.ppStateSeenClosed, tone: "ok" };
  if (r.state === "READ") return { text: STR.ppStateRead, tone: "info" };
  if (r.state === "SEEN") return { text: STR.ppStateSeenNotDone, tone: "warn" };
  return { text: STR.ppStateNotSeen, tone: "danger" };
}

export default function PopupReportScreen({ navigation, route }: Props): React.ReactElement {
  const id = route.params.id;
  const colors = useColors();
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const canSend = can("popup_notice:send_staff") || can("popup_notice:send_guardian");
  const canFollow = can("popup_notice:follow_up");
  const en = getActiveLang() === "en";

  const [noticeQ, refetchNotice] = useQuery({ query: POPUP_NOTICE, variables: { id }, requestPolicy: "cache-and-network" });
  const [repQ, refetchRep] = useQuery({ query: POPUP_NOTICE_REPORT, variables: { id }, requestPolicy: "network-only" });
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [peopleQ, refetchPeople] = useQuery({ query: POPUP_RECIPIENTS_PAGE, variables: { id, filter, page, pageSize: 30 }, requestPolicy: "network-only" });

  const [, remind] = useMutation(REMIND_POPUP_NOTICE);
  const [, addMatches] = useMutation(ADD_POPUP_MATCHES);
  const [, withdraw] = useMutation(WITHDRAW_POPUP_NOTICE);
  const [, duplicate] = useMutation(DUPLICATE_POPUP_NOTICE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const n = noticeQ.data?.popupNotice;
  const r = repQ.data?.popupNoticeReport;
  const people = peopleQ.data?.popupRecipientsPage;
  if (!n || !r) {
    if (noticeQ.error || repQ.error) return <ErrorBanner message={friendlyError(noticeQ.error ?? repQ.error)} />;
    return <Loader label={STR.loading} />;
  }

  const refresh = () => {
    refetchNotice({ requestPolicy: "network-only" });
    refetchRep({ requestPolicy: "network-only" });
    refetchPeople({ requestPolicy: "network-only" });
  };
  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const live = n.status === "PUBLISHED";
  const b = statusBadge(n);
  const notDone = r.reachable - r.done;
  const choiceTotal = r.reachable;
  const answeredSum = r.choices.reduce((a, c) => a + c.count, 0);
  const segColors = [colors.primary, colors.gold, colors.info];
  const filters: Array<{ key: string; label: string }> = [
    { key: "all", label: STR.ppPeopleAll },
    { key: "not_seen", label: STR.ppPeopleNotSeen },
    { key: "not_done", label: STR.ppPeopleNotDone },
    { key: "done", label: STR.ppPeopleDone },
    ...r.choices.map((c) => ({ key: `choice:${c.id}`, label: c.label })),
    ...(r.unreachable > 0 ? [{ key: "unreachable", label: STR.ppNoLogin }] : []),
  ];

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
          <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200, fontWeight: "700" }}>{en && n.titleEn ? n.titleEn : n.titleBn}</Body>
          <Badge text={b.text} tone={b.tone} />
        </View>
        <Muted>{n.audienceSummary}</Muted>
        <Muted>
          {[
            n.publishedAt ? STR.ppSentOn.replace("{d}", new Date(n.publishedAt).toLocaleDateString(en ? "en-GB" : "bn-BD")) : "",
            STR.ppEndsOnShort.replace("{d}", bnNum(n.endsOn)),
            n.publishedByName,
            n.version > 1 ? STR.ppEdited.replace("{n}", bnNum(n.version - 1)) : "",
          ].filter(Boolean).join(" · ")}
        </Muted>
      </Card>

      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(3) }}>
        <Tile k={STR.ppTileRecipients} v={bnNum(r.recipients)} s={r.unreachable > 0 ? STR.ppNoLoginCount.replace("{n}", bnNum(r.unreachable)) : STR.ppTileAllReachable} />
        <Tile k={STR.ppTileSeen} v={bnNum(r.seen)} s={STR.ppOfReach.replace("{p}", bnNum(pct(r.seen, r.reachable))).replace("{n}", bnNum(r.reachable))} />
        <Tile k={STR.ppTileRead} v={bnNum(r.read)} s={STR.ppOfReach.replace("{p}", bnNum(pct(r.read, r.reachable))).replace("{n}", bnNum(r.reachable))} />
        {r.choices.length > 0 ? (
          <Tile k={STR.ppTileAnswered} v={bnNum(r.acted)} s={STR.ppOfReach.replace("{p}", bnNum(pct(r.acted, r.reachable))).replace("{n}", bnNum(r.reachable))} />
        ) : (
          <Tile k={STR.ppTileDone} v={bnNum(r.done)} s={STR.ppOfReach.replace("{p}", bnNum(pct(r.done, r.reachable))).replace("{n}", bnNum(r.reachable))} />
        )}
      </View>

      {r.choices.length > 0 && choiceTotal > 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.ppAnswers}</Body>
          <View
            style={{ flexDirection: "row", height: 26, gap: 2, marginTop: space(2) }}
            accessibilityRole="image"
            accessibilityLabel={[...r.choices.map((c) => `${c.label} ${c.count}`), `${STR.ppNoAnswer} ${choiceTotal - answeredSum}`].join(", ")}
          >
            {r.choices.map((c, i) =>
              c.count > 0 ? (
                <View key={c.id} style={{ flex: c.count, backgroundColor: segColors[i % segColors.length], borderRadius: 4, justifyContent: "center", alignItems: "center" }}>
                  <Muted style={{ color: colors.surface, fontWeight: "700" }}>{bnNum(c.count)}</Muted>
                </View>
              ) : null,
            )}
            {choiceTotal - answeredSum > 0 ? (
              <View style={{ flex: choiceTotal - answeredSum, backgroundColor: colors.surfaceAlt, borderRadius: 4, justifyContent: "center", alignItems: "center" }}>
                <Muted style={{ fontWeight: "700" }}>{bnNum(choiceTotal - answeredSum)}</Muted>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
            {r.choices.map((c, i) => (
              <Legend key={c.id} color={segColors[i % segColors.length]} label={c.label} n={c.count} />
            ))}
            <Legend color={colors.surfaceAlt} label={STR.ppNoAnswer} n={choiceTotal - answeredSum} />
          </View>
        </Card>
      ) : null}

      {r.groups.length > 1 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{r.choices.length > 0 ? STR.ppByGroupAnswered : STR.ppByGroupDone}</Body>
          {r.groups.map((g) => {
            const part = r.choices.length > 0 ? g.acted : g.done;
            const p = pct(part, g.reachable);
            const low = g.reachable >= 3 && p < 60;
            return (
              <View key={g.group} style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}>
                <Muted style={{ width: 120 }}>{g.group}</Muted>
                <View style={{ flex: 1, height: 10, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, overflow: "hidden" }}>
                  <View style={{ width: `${p}%`, height: 10, backgroundColor: low ? colors.gold : colors.primary }} />
                </View>
                <Muted style={{ width: 96, textAlign: "right" }}>{`${bnNum(p)}% · ${bnNum(part)}/${bnNum(g.reachable)}${low ? " ⚠" : ""}`}</Muted>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "600" }}>{STR.ppEachPerson}</Body>
        <ChipRow>
          {filters.map((f) => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => { setFilter(f.key); setPage(1); }} />
          ))}
        </ChipRow>
        {peopleQ.fetching && !people ? <Loader /> : null}
        {(people?.rows ?? []).map((p) => {
          const st = personState(p);
          return (
            <View key={`${p.kind}:${p.id}`} style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, gap: space(1) }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
                <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>{p.name}</Body>
                <Badge text={st.text} tone={st.tone} />
              </View>
              <Muted>
                {[p.detail, p.group !== p.detail ? p.group : "", p.lastSeenAt ? STR.ppLastSeen.replace("{d}", new Date(p.lastSeenAt).toLocaleString(en ? "en-GB" : "bn-BD")) : "", p.deviceKinds.join(", ")]
                  .filter(Boolean)
                  .join(" · ")}
              </Muted>
              {p.waLink && (!p.reachable || !p.done) ? (
                <Button title={STR.ppWhatsApp} variant="ghost" onPress={() => void Linking.openURL(p.waLink)} />
              ) : null}
            </View>
          );
        })}
        {people ? <Pager page={people.page} pageSize={people.pageSize} total={people.total} onPage={setPage} /> : null}
      </Card>

      {live ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.ppFollowUp}</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            {canFollow ? (
              <Button
                title={STR.ppRemind.replace("{n}", bnNum(notDone))}
                variant="secondary"
                disabled={busy || notDone === 0}
                onPress={() =>
                  void run(async () => {
                    const res = await remind({ id });
                    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                    setMsg({ tone: "ok", text: STR.ppReminded.replace("{n}", bnNum(res.data?.remindPopupNotice ?? 0)) });
                    refresh();
                  })
                }
              />
            ) : null}
            {canFollow ? (
              <Button
                title={STR.ppAddMatches}
                variant="secondary"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const res = await addMatches({ id });
                    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                    setMsg({ tone: "ok", text: STR.ppAddedMatches.replace("{n}", bnNum(res.data?.addPopupMatches ?? 0)) });
                    refresh();
                  })
                }
              />
            ) : null}
            {r.unreachable > 0 ? (
              <Button title={STR.ppNoLoginList.replace("{n}", bnNum(r.unreachable))} variant="ghost" onPress={() => { setFilter("unreachable"); setPage(1); }} />
            ) : null}
          </View>
        </Card>
      ) : null}

      {canSend ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(6) }}>
          {live ? <Button title={STR.ppEditWords} variant="secondary" onPress={() => navigation.navigate("PopupCompose", { id })} /> : null}
          <Button
            title={STR.ppDuplicate}
            variant="secondary"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const res = await duplicate({ id });
                if (res.error || !res.data) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                navigation.navigate("PopupCompose", { id: res.data.duplicatePopupNotice.id });
              })
            }
          />
          {live ? (
            <Button
              title={STR.ppWithdraw}
              variant="danger"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  const ok = await confirmAction({ title: STR.ppWithdrawTitle, message: STR.ppWithdrawBody, confirmLabel: STR.ppWithdraw });
                  if (!ok) return;
                  const res = await withdraw({ id });
                  if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                  refresh();
                })
              }
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

function Tile({ k, v, s }: { k: string; v: string; s: string }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space(3), backgroundColor: colors.surface }}>
      <Muted>{k}</Muted>
      <Body style={{ ...typeScale.pageTitle, fontVariant: ["tabular-nums"] }}>{v}</Body>
      <Muted>{s}</Muted>
    </View>
  );
}

function Legend({ color, label, n }: { color: string; label: string; n: number }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Muted>{`${label} ${bnNum(n)}`}</Muted>
    </View>
  );
}
