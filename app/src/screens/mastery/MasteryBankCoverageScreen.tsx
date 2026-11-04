/**
 * MasteryBankCoverageScreen (OT-4, prd-objective-tree §8.2, mock 5 প্রশ্ন-ব্যাংক কভারেজ) — for one
 * class × subject, the gold questions on every tagged row of the objective list, the rows with
 * none highlighted, and the gaps as a brief to copy for the next Claude question batch (which comes
 * back through the normal import + review loop).
 *
 * Mounted twice: in the Reports hub (its own switch `reports:bank_coverage`, D-#846) with no
 * params, and from a class × subject card on the mastery home with that pair. The level words come
 * from useMasteryLevelLabels — never hard-coded (D-#923). The server re-gates every read.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "urql";
import { MASTERY_BANK_COVERAGE_QUERY, type BankCoverage, type BankCoverageRow } from "../../graphql/masteryBankCoverage";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { space, useColors } from "../../theme";
import { fill } from "./masteryStateUi";

type Params = { classToken?: string; subject?: string } | undefined;

export default function MasteryBankCoverageScreen({ route }: { route: { params?: Params } }): React.ReactElement {
  const colors = useColors();
  const words = useMasteryLevelLabels();
  const [pick, setPick] = useState<{ classToken: string; subject: string } | null>(
    route.params?.classToken && route.params?.subject ? { classToken: route.params.classToken, subject: route.params.subject } : null,
  );
  const [showBrief, setShowBrief] = useState(false);
  const [copied, setCopied] = useState(false);
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_BANK_COVERAGE_QUERY,
    variables: { classToken: pick?.classToken ?? null, subject: pick?.subject ?? null },
    requestPolicy: "cache-and-network",
  });
  const v = data?.masteryBankCoverage as BankCoverage | undefined;
  const rows = v?.rows ?? [];

  async function onCopy(): Promise<void> {
    if (!v?.brief) return;
    await Clipboard.setStringAsync(v.brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Group by chapter in list order (strands, with no chapter, come last from the server).
  const titleOf = new Map((v?.chapters ?? []).map((c) => [c.number, c.titleBn]));
  const groups: { key: string; title: string; rows: BankCoverageRow[] }[] = [];
  for (const r of rows) {
    const key = r.chapterNumber === null ? "strand" : String(r.chapterNumber);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const title =
        r.chapterNumber === null
          ? STR.bcStrands
          : `${fill(STR.bcChapter, { n: bnNum(r.chapterNumber) })}${titleOf.get(r.chapterNumber) ? ` · ${titleOf.get(r.chapterNumber)}` : ""}`;
      g = { key, title, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  }

  return (
    <Screen scroll>
      {v && v.pairs.length > 1 ? (
        <ChipRow>
          {v.pairs.map((p) => (
            <Chip
              key={`${p.classToken}:${p.subject}`}
              label={`${masteryClassLabel(p.classToken)} · ${hwSubjectLabel(p.subject)}`}
              selected={p.classToken === v.classToken && p.subject === v.subject}
              onPress={() => setPick({ classToken: p.classToken, subject: p.subject })}
            />
          ))}
        </ChipRow>
      ) : null}

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching && !v ? <Loader /> : null}
      {v && v.pairs.length === 0 ? <EmptyState message={STR.bcNoCatalogue} /> : null}

      {v && v.classToken && v.pairs.length > 0 ? (
        <>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700" }}>
                {masteryClassLabel(v.classToken)} · {hwSubjectLabel(v.subject ?? "")}
              </Body>
              <Badge text={v.locked ? STR.bcListLocked : STR.bcListNotLocked} tone={v.locked ? "ok" : "gold"} />
            </View>
            <Muted>
              {fill(STR.bcTotals, { rows: bnNum(v.totals.rows), gold: bnNum(v.totals.gold) })}
              {v.totals.rubricRows > 0 ? ` · ${fill(STR.bcRubricRows, { n: bnNum(v.totals.rubricRows) })}` : ""}
            </Muted>
          </Card>

          {v.totals.zeroRows > 0 ? (
            <Notice tone="warn" message={fill(STR.bcZeroNotice, { n: bnNum(v.totals.zeroRows) })} />
          ) : rows.length > 0 ? (
            <Notice tone="ok" message={STR.bcAllCovered} />
          ) : (
            <EmptyState message={STR.bcNoRows} />
          )}

          {groups.map((g) => (
            <Card key={g.key}>
              <Body style={{ fontWeight: "700" }}>{g.title}</Body>
              {g.rows.map((r) => {
                const gap = r.goldCount === 0;
                return (
                  <View
                    key={r.code}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: space(2),
                      paddingVertical: space(1),
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Body style={gap ? { color: colors.error } : undefined}>{r.labelBn}</Body>
                      <Muted style={{ fontSize: 12 }}>
                        {r.level === "SUB" ? words.sub : words.objective}
                        {r.parentLabelBn ? ` · ${r.parentLabelBn}` : ""} · {r.code}
                        {r.pendingCount > 0 ? ` · ${fill(STR.bcPending, { n: bnNum(r.pendingCount) })}` : ""}
                      </Muted>
                    </View>
                    <Body style={{ fontWeight: "700", color: gap ? colors.error : colors.textPrimary }}>{bnNum(r.goldCount)}</Body>
                  </View>
                );
              })}
            </Card>
          ))}

          {v.totals.zeroRows > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.bcBriefTitle}</Body>
              <Muted>{STR.bcBriefHint}</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <Button title={copied ? STR.bcCopied : STR.bcCopyBrief} onPress={onCopy} />
                <Button title={showBrief ? STR.bcHideBrief : STR.bcShowBrief} variant="secondary" onPress={() => setShowBrief(!showBrief)} />
              </View>
              {showBrief ? (
                <Text selectable style={{ fontSize: 12, lineHeight: 18, color: colors.textSecondary }}>
                  {v.brief}
                </Text>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
