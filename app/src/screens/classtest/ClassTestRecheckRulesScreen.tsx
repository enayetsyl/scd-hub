/**
 * ClassTestRecheckRulesScreen (CT-RC, owner 2026-11-10: "keep the configuration option
 * for changing the % range") — the unusual-mark thresholds, for class_test:publish
 * holders (the approvers). Every value is percent of the test's total; each line also
 * says what it means on the usual 20-mark test (1 mark = 5%). Whole numbers only — the
 * server enforces the same bounds and audits every change.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { CT_RECHECK_RULES_QUERY, SAVE_CT_RECHECK_RULES, type CtRecheckRulesT } from "../../graphql/classTestRecheck";
import { Body, Button, Card, Field, Loader, Muted, Notice, Screen } from "../../components/ui";
import { TickBox, ctrcFill } from "../../components/CtRecheckPanel";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme/tokens";

type NumKey = "highPct" | "lowPct" | "fullMarksBelowPct" | "classHighPct" | "minPriorTests";

const FIELDS: Array<{ key: NumKey; label: () => string; marks: boolean }> = [
  { key: "highPct", label: () => STR.ctrcRulesHigh, marks: true },
  { key: "lowPct", label: () => STR.ctrcRulesLow, marks: true },
  { key: "fullMarksBelowPct", label: () => STR.ctrcRulesFull, marks: true },
  { key: "classHighPct", label: () => STR.ctrcRulesClass, marks: true },
  { key: "minPriorTests", label: () => STR.ctrcRulesMin, marks: false },
];

const toNum = (t: string): number => Number(t.trim().replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));

export default function ClassTestRecheckRulesScreen(): React.ReactElement {
  const { can } = useAuth();
  const canEdit = can("class_test:publish");
  const [q, refetch] = useQuery({ query: CT_RECHECK_RULES_QUERY, variables: {}, requestPolicy: "network-only" });
  const [{ fetching: saving }, save] = useMutation(SAVE_CT_RECHECK_RULES);
  const rules: CtRecheckRulesT | null = q.data?.classTestRecheckRules ?? null;
  const [form, setForm] = useState<Record<NumKey, string>>({ highPct: "", lowPct: "", fullMarksBelowPct: "", classHighPct: "", minPriorTests: "" });
  const [enabled, setEnabled] = useState(true);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rules) return;
    setForm({
      highPct: String(rules.highPct),
      lowPct: String(rules.lowPct),
      fullMarksBelowPct: String(rules.fullMarksBelowPct),
      classHighPct: String(rules.classHighPct),
      minPriorTests: String(rules.minPriorTests),
    });
    setEnabled(rules.enabled);
  }, [rules]);

  async function onSave(): Promise<void> {
    setOk(null);
    setError(null);
    const vars: Partial<Record<NumKey, number>> = {};
    for (const f of FIELDS) {
      const n = toNum(form[f.key]);
      if (!Number.isInteger(n)) {
        setError(`${f.label()}: ${STR.ctrcRulesIntro}`);
        return;
      }
      vars[f.key] = n;
    }
    const res = await save({ ...vars, enabled });
    if (res.error) setError(friendlyError(res.error));
    else {
      setOk(STR.ctrcRulesSaved);
      refetch({ requestPolicy: "network-only" });
    }
  }

  if (q.fetching && !rules) return <Loader label={STR.loading} />;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.ctrcRulesTitle}</Body>
          <Muted>{STR.ctrcRulesIntro}</Muted>
          {rules?.isDefault ? <Muted>{STR.ctrcRulesDefault}</Muted> : null}
          <View style={{ marginTop: space(3) }}>
            <TickBox checked={enabled} label={STR.ctrcRulesEnabled} onPress={() => setEnabled(!enabled)} disabled={!canEdit} />
          </View>
          {FIELDS.map((f) => {
            const n = toNum(form[f.key]);
            const marks = Number.isFinite(n) ? Math.round((n / 5) * 10) / 10 : null;
            return (
              <View key={f.key} style={{ marginTop: space(3) }}>
                <Field
                  label={f.label()}
                  value={form[f.key]}
                  onChangeText={(t) => setForm((s) => ({ ...s, [f.key]: t }))}
                  keyboardType="number-pad"
                  editable={canEdit}
                  helper={f.marks && marks !== null ? `${bnNum(form[f.key])}% · ${ctrcFill(STR.ctrcRulesMarks, { m: bnNum(marks) })}` : undefined}
                />
              </View>
            );
          })}
          {canEdit ? <Button title={STR.ctrcRulesSave} onPress={() => void onSave()} loading={saving} disabled={saving} /> : null}
        </Card>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
      </ScrollView>
    </Screen>
  );
}
