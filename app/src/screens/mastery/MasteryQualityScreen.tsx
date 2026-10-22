/**
 * MasteryQualityScreen (M-3, mock I4 + scenario S8, D-#782) — how well each confirmed sheet's
 * questions worked for one শাখা × subject: per item full-marks %, re-work %, the top-vs-bottom
 * gap and a signal. Report only. The one action is the teacher's "do not use in this section's
 * diagnosis" — this sheet only, or (bank questions) every sheet with that question — with a
 * reason, and reversible.
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  EXCLUDE_MASTERY_ITEM,
  MASTERY_PAPER_QUALITY_QUERY,
  MASTERY_QUALITY_PAPERS_PAGE_QUERY,
  REVOKE_MASTERY_EXCLUSION,
  type MasteryPaperQualityData,
  type MasteryQualityPaperRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, masteryQualityLabel, masterySourceLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryQuality">;

const sourceLabel = masterySourceLabel;
const signalTone = (s: string) => (s === "MAY_BE_UNCLEAR" ? "danger" : s === "TOO_EASY" ? "gold" : "info");

export default function MasteryQualityScreen({ route }: Props): React.ReactElement {
  const { sectionId, subject } = route.params;
  const colors = useColors();
  const { can } = useAuth();
  const canExclude = can("mastery:enter_results");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [everySheet, setEverySheet] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [{ data: listData, fetching: listFetching, error: listError }] = useQuery({
    query: MASTERY_QUALITY_PAPERS_PAGE_QUERY,
    variables: { sectionId, subject, page, pageSize: 12 },
    requestPolicy: "cache-and-network",
  });
  const pg = listData?.masteryQualityPapersPage as { rows: MasteryQualityPaperRow[]; total: number; pageSize: number } | undefined;
  const papers = pg?.rows ?? [];
  const pages = pg ? Math.max(1, Math.ceil(pg.total / pg.pageSize)) : 1;
  const active = picked ?? papers[0]?.paper.paperId ?? null;

  const [{ data, fetching, error }, refetch] = useQuery({
    query: MASTERY_PAPER_QUALITY_QUERY,
    variables: { paperId: active ?? "" },
    pause: !active,
    requestPolicy: "cache-and-network",
  });
  const q = data?.masteryPaperQuality as MasteryPaperQualityData | undefined;
  const [exState, exclude] = useMutation(EXCLUDE_MASTERY_ITEM);
  const [rvState, revoke] = useMutation(REVOKE_MASTERY_EXCLUSION);

  const onExclude = async (itemNo: number) => {
    if (!active) return;
    setMsg(null);
    const res = await exclude({ paperId: active, itemNo, scope: everySheet ? "QID" : "ITEM", reason });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return;
    }
    setOpenItem(null);
    setReason("");
    setEverySheet(false);
    refetch({ requestPolicy: "network-only" });
  };
  const onRevoke = async (exclusionId: string) => {
    setMsg(null);
    const res = await revoke({ exclusionId });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return;
    }
    refetch({ requestPolicy: "network-only" });
  };

  if (listFetching && papers.length === 0) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }

  return (
    <Screen scroll wide>
      <Muted>{STR.msQualityIntro}</Muted>
      {listError ? <Notice message={friendlyError(listError)} tone="danger" /> : null}
      {!listError && papers.length === 0 ? <EmptyState message={STR.msNoConfirmed} /> : null}

      {papers.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          {papers.map((p) => {
            const on = p.paper.paperId === active;
            return (
              <Pressable
                key={p.paper.paperId}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => { setPicked(p.paper.paperId); setOpenItem(null); setMsg(null); }}
                style={{
                  minWidth: 180, flexGrow: 1, flexBasis: 180, padding: space(3), borderRadius: 10, gap: 4,
                  borderWidth: on ? 2 : 1, borderColor: on ? colors.primary : colors.border, backgroundColor: colors.surface,
                }}
              >
                <Muted>
                  {sourceLabel(p.paper.source)} · {bnNum(p.paper.date)}
                </Muted>
                <Body style={{ fontWeight: "700" }}>
                  {p.paper.paperId} · {bnNum(p.paper.items.length)} {STR.msItems}
                </Body>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                  <Badge text={fill(STR.msMean, { n: p.meanPct === null ? "—" : bnNum(p.meanPct) })} tone="muted" />
                  <Badge text={p.flagged > 0 ? fill(STR.msFlagged, { n: bnNum(p.flagged) }) : STR.msAllFine} tone={p.flagged > 0 ? "gold" : "ok"} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {pages > 1 ? (
        <View style={{ flexDirection: "row", gap: space(2), justifyContent: "center" }}>
          <Button title="‹" variant="secondary" disabled={page <= 1} onPress={() => setPage((n) => n - 1)} />
          <Body>
            {bnNum(page)} / {bnNum(pages)}
          </Body>
          <Button title="›" variant="secondary" disabled={page >= pages} onPress={() => setPage((n) => n + 1)} />
        </View>
      ) : null}

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="danger" /> : null}
      {active && fetching && !q ? <Loader /> : null}

      {q ? (
        <>
          <Muted>{fill(STR.msEvidenceOf, { n: bnNum(q.students), of: bnNum(q.rosterSize) })}</Muted>
          {q.items.map((it) => {
            const item = q.paper.items.find((x) => x.itemNo === it.itemNo);
            const ex = it.exclusion;
            const open = openItem === it.itemNo;
            return (
              <Card key={it.itemNo}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                    {STR.msItems} {bnNum(it.itemNo)} · {item?.questionTypeCode ?? ""} · {bnNum(item?.marks ?? 0)}
                  </Body>
                  <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
                    {it.signals.length === 0 ? <Badge text={STR.msAllFine} tone="ok" /> : null}
                    {it.signals.map((s) => (
                      <Badge key={s} text={masteryQualityLabel(s)} tone={signalTone(s)} />
                    ))}
                  </View>
                </View>
                <Muted style={{ fontSize: 12 }}>
                  {item?.loCodes.join(", ")}
                  {item?.qid ? ` · ${item.qid}` : ""}
                </Muted>
                {item?.textBn ? <Body numberOfLines={2}>{item.textBn}</Body> : null}
                <View style={{ flexDirection: "row", gap: space(4), flexWrap: "wrap", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
                    <View style={{ width: 90, height: 8, borderRadius: 999, backgroundColor: colors.surfaceAlt, overflow: "hidden" }}>
                      <View style={{ width: `${it.facility ?? 0}%`, height: "100%", backgroundColor: colors.primary }} />
                    </View>
                    <Muted>
                      {STR.msFullMarks} {it.facility === null ? "—" : `${bnNum(it.facility)}%`}
                    </Muted>
                  </View>
                  <Muted>
                    {STR.msReworkCount} {it.reworkRate === null ? "—" : `${bnNum(it.reworkRate)}%`}
                  </Muted>
                  <Muted>
                    {STR.msGap} {it.discrimination === null ? "—" : bnNum(it.discrimination)}
                  </Muted>
                </View>

                {ex ? (
                  <View style={{ gap: space(1), backgroundColor: colors.surfaceAlt, borderRadius: 8, padding: space(2) }}>
                    <Body>{fill(STR.msExcludedBy, { by: ex.byName || "—", reason: ex.reason })}</Body>
                    {ex.scope === "QID" ? <Muted>{STR.msExcludeEverySheet}</Muted> : null}
                    {canExclude ? (
                      <Button title={STR.msRevoke} variant="secondary" disabled={rvState.fetching} onPress={() => onRevoke(ex.id)} />
                    ) : null}
                  </View>
                ) : canExclude && !open ? (
                  <Button title={STR.msExclude} variant="ghost" onPress={() => { setOpenItem(it.itemNo); setReason(""); setEverySheet(false); }} />
                ) : null}

                {!ex && open ? (
                  <View style={{ gap: space(2) }}>
                    <Field label={STR.msExcludeReason} value={reason} onChangeText={setReason} multiline />
                    {item?.qid ? (
                      <ChipRow>
                        <Chip label={STR.msExcludeThisSheet} selected={!everySheet} onPress={() => setEverySheet(false)} />
                        <Chip label={STR.msExcludeEverySheet} selected={everySheet} onPress={() => setEverySheet(true)} />
                      </ChipRow>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button
                        title={STR.msExcludeConfirm}
                        variant="danger"
                        disabled={!reason.trim() || exState.fetching}
                        onPress={() => onExclude(it.itemNo)}
                      />
                      <Button title={STR.msCancel} variant="secondary" onPress={() => setOpenItem(null)} />
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })}
          <Muted>{STR.msGapNote}</Muted>
        </>
      ) : null}
    </Screen>
  );
}
