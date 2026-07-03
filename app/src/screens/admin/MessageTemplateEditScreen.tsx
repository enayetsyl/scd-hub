/**
 * MessageTemplateEditScreen (MT-3, D-#129/#130) — edit one generated-message
 * template: Bangla + English bodies, a BN/EN/BOTH language toggle, allowed-
 * placeholder chips (tap to insert), a live preview rendered with sample values,
 * the edit history, and reset-to-default. Edit-time validation errors (the Bangla
 * 422) surface inline. Gated `template:manage` (server re-checks every call).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  TEMPLATE_LANGUAGE_MODES,
  TEMPLATE_LANGUAGE_MODE_LABELS_BN,
  TEMPLATE_LANGUAGE_MODE_LABELS_EN,
  type TemplateLanguageMode,
} from "@scd/shared";
import {
  MESSAGE_TEMPLATE_QUERY,
  MESSAGE_TEMPLATE_HISTORY_QUERY,
  EDIT_MESSAGE_TEMPLATE,
  RESET_MESSAGE_TEMPLATE,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen, Body, Muted, Card, Button, Badge, Field, Select, Chip, ChipRow, Notice, Loader, ErrorBanner,
} from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useLanguage } from "../../state/LanguageContext";
import { useConfirm } from "../../state/ConfirmContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "MessageTemplateEdit">;

/** Sample values for the live preview (§3.4) — "Karim"/"Math"-style fillers. */
const SAMPLE: Record<string, string> = {
  subject: "গণিত",
  studentName: "করিম",
  asId: "AS-C2-MATH-0003",
  deliveryDate: "01/06/2026",
  dueDate: "05/06/2026",
  hwId: "HW-123",
  chaseCount: "3",
  classLevel: "2",
  anchorWord: "অধ্যায়",
  addressNumber: "5",
  roundNumber: "1",
  dateKey: "2026-06-13",
  periodNumber: "3",
  endHHMM: "12:30",
  count: "2",
  lines: "পিরিয়ড ৩ — গণিত",
  section: "প্রথম-ক",
  title: "সীরাত গ্রন্থ",
  dueKey: "2026-06-10",
  borrowerName: "করিম",
  accessionNo: "ACC-001",
  dueDateKey: "2026-06-10",
  name: "করিম",
  identifier: "01711000000",
  password: "Ab2Cd3Ef",
  setTitle: "গণিত সেট-১",
};

/** Fill {tokens} with sample values; unknown → [name] so the shape stays visible. */
function fill(body: string): string {
  return body.replace(/\{(\w+)\}/g, (_m, k: string) => (SAMPLE[k] !== undefined ? SAMPLE[k] : `[${k}]`));
}

export default function MessageTemplateEditScreen({ route, navigation }: Props): React.ReactElement {
  const { key } = route.params;
  const { lang } = useLanguage();
  const [{ data, fetching, error }, refetch] = useQuery({ query: MESSAGE_TEMPLATE_QUERY, variables: { key } });
  const [historyQ, refetchHistory] = useQuery({ query: MESSAGE_TEMPLATE_HISTORY_QUERY, variables: { key } });
  const [, edit] = useMutation(EDIT_MESSAGE_TEMPLATE);
  const [, reset] = useMutation(RESET_MESSAGE_TEMPLATE);
  const { confirmAction } = useConfirm();

  const tpl = data?.messageTemplate ?? null;

  const [bnBody, setBnBody] = React.useState("");
  const [enBody, setEnBody] = React.useState("");
  const [langMode, setLangMode] = React.useState<TemplateLanguageMode>("BN");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  // Seed the form once the template loads (effective body — override or default).
  React.useEffect(() => {
    if (tpl && !loaded) {
      setBnBody(tpl.bnBody);
      setEnBody(tpl.enBody ?? "");
      setLangMode((tpl.langMode as TemplateLanguageMode) ?? "BN");
      setLoaded(true);
    }
  }, [tpl, loaded]);

  if (fetching && !data) return <Loader label={STR.mtTitle} />;
  if (error) return <Screen padded><ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /></Screen>;
  if (!tpl) return <Screen padded><Notice message={STR.mtHistoryEmpty} tone="warn" /></Screen>;

  const modeLabels = lang === "en" ? TEMPLATE_LANGUAGE_MODE_LABELS_EN : TEMPLATE_LANGUAGE_MODE_LABELS_BN;
  const langOptions = TEMPLATE_LANGUAGE_MODES.map((m) => ({ label: modeLabels[m], value: m }));

  function insertPlaceholder(p: string): void {
    setBnBody((b) => `${b}{${p}}`);
  }

  const preview =
    langMode === "EN"
      ? fill(enBody)
      : langMode === "BOTH"
        ? `${fill(bnBody)}${enBody ? `\n\n${fill(enBody)}` : ""}`
        : fill(bnBody);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    setOk(null);
    const res = await edit({ key, bnBody, enBody: enBody.trim() === "" ? null : enBody, langMode });
    setBusy(false);
    if (res.error || !res.data?.editMessageTemplate) {
      setErr(friendlyError(res.error));
      return;
    }
    setOk(STR.mtSaved);
    refetch({ requestPolicy: "network-only" });
    refetchHistory({ requestPolicy: "network-only" });
  }

  async function doReset(): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.mtReset }))) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    const res = await reset({ key });
    setBusy(false);
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setOk(res.data?.resetMessageTemplate.reset ? STR.mtResetDone : STR.mtNoOverrideToReset);
    // Re-seed from the (now default) server value.
    setLoaded(false);
    refetch({ requestPolicy: "network-only" });
    refetchHistory({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(2) }}>
        <Body style={{ flex: 1, fontWeight: "700" }}>{tpl.labelBn}</Body>
        <Badge text={tpl.isDefault ? STR.mtDefaultBadge : STR.mtOverriddenBadge} tone={tpl.isDefault ? "muted" : "info"} />
      </View>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}

      {/* Allowed placeholders (tap to insert into the Bangla body) */}
      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.mtAllowedPlaceholders}</Body>
      {tpl.placeholders.length === 0 ? (
        <Muted style={{ marginBottom: space(2) }}>{STR.mtNoPlaceholders}</Muted>
      ) : (
        <ChipRow>
          {tpl.placeholders.map((p) => (
            <Chip key={p} label={`{${p}}`} onPress={() => insertPlaceholder(p)} />
          ))}
        </ChipRow>
      )}

      <Field label={STR.mtBnBody} value={bnBody} onChangeText={setBnBody} multiline autoCapitalize="sentences" />
      <Field label={STR.mtEnBody} value={enBody} onChangeText={setEnBody} multiline autoCapitalize="sentences" />
      <Select<TemplateLanguageMode> label={STR.mtLangMode} value={langMode} options={langOptions} onChange={setLangMode} />

      {/* Live preview with sample values */}
      <Body style={{ fontWeight: "700", marginTop: space(2) }}>{STR.mtPreview}</Body>
      <Card>
        <Body>{preview}</Body>
      </Card>

      <View style={{ gap: space(2), marginTop: space(2) }}>
        <Button title={STR.mtSave} onPress={() => void save()} loading={busy} disabled={busy} />
        {!tpl.isDefault ? (
          <Button title={STR.mtReset} variant="danger" onPress={() => void doReset()} disabled={busy} />
        ) : null}
      </View>

      {/* Edit history */}
      <Body style={{ fontWeight: "700", marginTop: space(4), marginBottom: space(1) }}>{STR.mtEditHistory}</Body>
      {(historyQ.data?.messageTemplateHistory ?? []).length === 0 ? (
        <Muted>{STR.mtHistoryEmpty}</Muted>
      ) : (
        (historyQ.data?.messageTemplateHistory ?? []).map((h, i) => (
          <Card key={i}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body style={{ fontWeight: "700" }}>{h.action === "reset" ? STR.mtActionReset : STR.mtActionEdit}</Body>
              <Muted>{new Date(h.at).toLocaleString()}</Muted>
            </View>
            {h.priorBnBody ? (
              <Muted style={{ marginTop: 2 }}>
                {STR.mtPriorBody}: {h.priorBnBody}
              </Muted>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
