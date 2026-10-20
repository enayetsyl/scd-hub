/**
 * MasteryTagsScreen (M-0, mock A3 left) — the diagnosis tags teachers put on a question or
 * a whole piece of work (D-#778), including the mark-deduction tags that feed a skill
 * strand (D-#787). The seed tags arrive on first read; routing tags start OFF and are
 * switched on per class × subject once that catalogue holds the strand.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  MASTERY_COVERAGE_QUERY,
  MASTERY_TAGS_QUERY,
  SAVE_MASTERY_TAG,
  type MasteryCoverageRow,
  type MasteryTagRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel, masteryTagEffectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryTags">;

const EFFECTS = ["WEAK", "LIGHT", "NO_EVIDENCE", "VOID_BEHAVIOUR", "ROUTE_STRAND"] as const;
const APPLIES = ["ITEM", "WORK", "BOTH"] as const;
const appliesLabel = (a: string) => (a === "ITEM" ? STR.msAppliesItem : a === "WORK" ? STR.msAppliesWork : STR.msAppliesBoth);
const scopeKey = (s: { classToken: string; subject: string }) => `${s.classToken}:${s.subject}`;

type Draft = {
  code: string;
  labelBn: string;
  appliesTo: string;
  effect: string;
  routeStrand: string;
  level: string;
  questionTypeCodes: string;
  deductionMarks: string;
  allScopes: boolean;
  scopes: string[];
  active: boolean;
  isNew: boolean;
};

const toDraft = (t: MasteryTagRow): Draft => ({
  code: t.code,
  labelBn: t.labelBn,
  appliesTo: t.appliesTo,
  effect: t.effect,
  routeStrand: t.routeStrand ?? "",
  level: t.level ?? (t.appliesTo === "WORK" ? "WORK" : "ITEM"),
  questionTypeCodes: t.questionTypeCodes.join(", "),
  deductionMarks: t.deductionMarks === null ? "" : String(t.deductionMarks),
  allScopes: t.allScopes,
  scopes: t.scopes.map(scopeKey),
  active: t.active,
  isNew: false,
});

const blank: Draft = {
  code: "",
  labelBn: "",
  appliesTo: "ITEM",
  effect: "WEAK",
  routeStrand: "",
  level: "ITEM",
  questionTypeCodes: "",
  deductionMarks: "",
  allScopes: true,
  scopes: [],
  active: true,
  isNew: true,
};

export default function MasteryTagsScreen(_props: Props): React.ReactElement {
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("mastery:manage");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [{ data, fetching, error: qErr }, refetch] = useQuery({ query: MASTERY_TAGS_QUERY });
  const [{ data: cov }] = useQuery({ query: MASTERY_COVERAGE_QUERY });
  const [save, saveTag] = useMutation(SAVE_MASTERY_TAG);
  const tags = (data?.masteryTags ?? []) as MasteryTagRow[];
  const pairs = (cov?.masteryCoverage ?? []) as MasteryCoverageRow[];

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function onSave(): Promise<void> {
    if (!draft) return;
    setError(null);
    const isRoute = draft.effect === "ROUTE_STRAND";
    const ded = draft.deductionMarks.trim() ? Number(draft.deductionMarks) : null;
    const input = {
      code: draft.code.trim(),
      labelBn: draft.labelBn.trim(),
      appliesTo: draft.appliesTo,
      effect: draft.effect,
      routeStrand: isRoute ? draft.routeStrand.trim().toUpperCase() : null,
      routeSeq: isRoute ? 1 : null,
      level: isRoute ? draft.level : null,
      questionTypeCodes: isRoute ? draft.questionTypeCodes.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) : [],
      deductionMarks: isRoute && ded !== null && Number.isFinite(ded) ? ded : null,
      allScopes: isRoute ? false : draft.allScopes,
      scopes: draft.scopes.map((k) => {
        const [classToken, subject] = k.split(":");
        return { classToken, subject };
      }),
      active: draft.active,
    };
    const res = await saveTag({ input });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.msTagSaved);
    setDraft(null);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <Notice message={STR.msRouteNote} tone="info" />
      {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
      {fetching && tags.length === 0 ? <Loader /> : null}

      {tags.map((t) => (
        <Card key={t.code}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <Body style={{ fontWeight: "700", flexShrink: 1 }}>{t.labelBn}</Body>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap" }}>
              <Badge text={t.active ? STR.msActive : STR.msInactive} tone={t.active ? "ok" : "muted"} />
              {t.system ? <Badge text={STR.msSystemTag} tone="info" /> : null}
            </View>
          </View>
          <Muted>
            {t.code} · {appliesLabel(t.appliesTo)} · {masteryTagEffectLabel(t.effect)}
            {t.routeStrand ? ` → SK-${t.routeStrand}` : ""}
            {t.deductionMarks !== null ? ` · −${bnNum(t.deductionMarks)}` : ""}
          </Muted>
          <Muted>
            {t.allScopes
              ? STR.msEverywhere
              : t.scopes.map((s) => `${masteryClassLabel(s.classToken)} ${hwSubjectLabel(s.subject)}`).join(", ") || "—"}
          </Muted>
          {canManage ? <Button title={STR.msEdit} variant="secondary" onPress={() => setDraft(toDraft(t))} /> : null}
        </Card>
      ))}

      {canManage && !draft ? <Button title={STR.msAddTag} onPress={() => setDraft({ ...blank })} /> : null}

      {draft ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{draft.isNew ? STR.msAddTag : draft.code}</Body>
          {draft.isNew ? (
            <Field label={STR.msTagCode} value={draft.code} onChangeText={(v) => set({ code: v.toUpperCase() })} autoCapitalize="characters" />
          ) : null}
          <Field label={STR.msTagName} value={draft.labelBn} onChangeText={(v) => set({ labelBn: v })} />
          <Muted>{STR.msEffect}</Muted>
          <ChipRow>
            {EFFECTS.map((e) => (
              <Chip key={e} label={masteryTagEffectLabel(e)} selected={draft.effect === e} onPress={() => set({ effect: e })} />
            ))}
          </ChipRow>
          <Muted>{STR.msAppliesTo}</Muted>
          <ChipRow>
            {APPLIES.map((a) => (
              <Chip key={a} label={appliesLabel(a)} selected={draft.appliesTo === a} onPress={() => set({ appliesTo: a, level: a === "WORK" ? "WORK" : "ITEM" })} />
            ))}
          </ChipRow>
          {draft.effect === "ROUTE_STRAND" ? (
            <>
              <Field label={STR.msRouteStrand} value={draft.routeStrand} onChangeText={(v) => set({ routeStrand: v.toUpperCase() })} autoCapitalize="characters" />
              {draft.level === "ITEM" ? (
                <Field label={STR.msRouteItemTypes} value={draft.questionTypeCodes} onChangeText={(v) => set({ questionTypeCodes: v })} autoCapitalize="characters" />
              ) : null}
              <Field label={STR.msDeduction} value={draft.deductionMarks} onChangeText={(v) => set({ deductionMarks: v })} keyboardType="decimal-pad" />
            </>
          ) : (
            <ChipRow>
              <Chip label={STR.msEverywhere} selected={draft.allScopes} onPress={() => set({ allScopes: !draft.allScopes })} />
            </ChipRow>
          )}
          {draft.effect === "ROUTE_STRAND" || !draft.allScopes ? (
            <>
              <Muted>{STR.msScopes}</Muted>
              <ChipRow>
                {pairs.map((p) => {
                  const k = scopeKey(p);
                  const on = draft.scopes.includes(k);
                  return (
                    <Chip
                      key={k}
                      label={`${masteryClassLabel(p.classToken)} ${hwSubjectLabel(p.subject)}`}
                      selected={on}
                      onPress={() => set({ scopes: on ? draft.scopes.filter((x) => x !== k) : [...draft.scopes, k] })}
                    />
                  );
                })}
              </ChipRow>
            </>
          ) : null}
          <ChipRow>
            <Chip label={STR.msActive} selected={draft.active} onPress={() => set({ active: true })} />
            <Chip label={STR.msInactive} selected={!draft.active} onPress={() => set({ active: false })} />
          </ChipRow>
          {error ? <Notice message={error} tone="danger" /> : null}
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.msSave} onPress={() => void onSave()} loading={save.fetching} disabled={!draft.code.trim() || !draft.labelBn.trim()} />
            <Button title={STR.msCancel} variant="secondary" onPress={() => { setDraft(null); setError(null); }} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
