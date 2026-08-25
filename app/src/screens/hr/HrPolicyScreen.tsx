/**
 * HrPolicyScreen (SH-8; docs/prd-staff-hub.md §4) — the school-wide HR numbers.
 *
 * SH-3 and SH-4 shipped `HrPolicy` with read-time defaults and a `setHrPolicy`
 * mutation, but no surface: the lateness rule could only be switched on over the wire,
 * which is not a thing anyone should have to do to use a shipped feature.
 *
 * Two of these switches change how real money and real balances are computed, so each
 * one says what it will do BEFORE it is touched — the lateness note distinguishes
 * "takes effect next payroll" from "already-locked payslips are untouched", and the
 * letters section says plainly that edits reach new letters only (D-#542: an issued
 * letter keeps the signatory it was signed with, because its snapshot froze it).
 *
 * Gate: `payroll:manage` (Principal + Office), the same permission that already
 * governs pay. No new permission (D-#543).
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import { HR_POLICY_QUERY, SET_HR_POLICY } from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Field,
  Chip,
  ChipRow,
  Button,
  Divider,
  Loader,
  Notice,
} from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function HrPolicyScreen(): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: HR_POLICY_QUERY });
  const [, save] = useMutation(SET_HR_POLICY);

  const p = data?.hrPolicy;

  const [annualLeaveDays, setAnnualLeaveDays] = React.useState("");
  const [lateDaysPerCharge, setLateDaysPerCharge] = React.useState("");
  const [latenessOn, setLatenessOn] = React.useState(false);
  const [probationOn, setProbationOn] = React.useState(true);
  const [signatoryName, setSignatoryName] = React.useState("");
  const [signatoryTitle, setSignatoryTitle] = React.useState("");
  const [weeklyHoursText, setWeeklyHoursText] = React.useState("");
  const [letterRefPrefix, setLetterRefPrefix] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  // Seed the form from the server ONCE the policy arrives. Keyed on the loaded object
  // so a refetch after save does not clobber a field the user is mid-edit.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!p || seeded.current) return;
    seeded.current = true;
    setAnnualLeaveDays(String(p.annualLeaveDays));
    setLateDaysPerCharge(String(p.lateDaysPerCharge));
    setLatenessOn(p.latenessRuleEnabled);
    setProbationOn(p.probationDebtEnabled);
    setSignatoryName(p.signatoryName);
    setSignatoryTitle(p.signatoryTitle);
    setWeeklyHoursText(p.weeklyHoursText);
    setLetterRefPrefix(p.letterRefPrefix);
  }, [p]);

  const poolChanged = !!p && Number(annualLeaveDays) !== p.annualLeaveDays;
  const canSave =
    Number(annualLeaveDays) >= 0 &&
    Number(lateDaysPerCharge) >= 1 &&
    signatoryName.trim() !== "" &&
    signatoryTitle.trim() !== "";

  async function onSave(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    const res = await save({
      annualLeaveDays: Number(annualLeaveDays),
      lateDaysPerCharge: Number(lateDaysPerCharge),
      latenessRuleEnabled: latenessOn,
      probationDebtEnabled: probationOn,
      signatoryName: signatoryName.trim(),
      signatoryTitle: signatoryTitle.trim(),
      weeklyHoursText: weeklyHoursText.trim(),
      letterRefPrefix: letterRefPrefix.trim(),
    });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setNotice(STR.stfPolicySaved);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && !p) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll>
        <H2>{STR.stfPolicyTitle}</H2>
        <Notice tone="danger" message={friendlyError(error)} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <H2>{STR.stfPolicyTitle}</H2>
      <Muted>{STR.stfPolicySub}</Muted>

      {notice ? <Notice tone="ok" message={notice} /> : null}
      {failure ? <Notice tone="danger" message={failure} /> : null}

      {/* --- leave ---------------------------------------------------------- */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfPolicyLeave}</Body>
        <Field
          label={STR.stfPolicyAnnualDays}
          value={annualLeaveDays}
          onChangeText={setAnnualLeaveDays}
          keyboardType="numeric"
        />
        <Muted>{STR.stfPolicyAnnualNote}</Muted>
        {poolChanged ? <Notice tone="warn" message={STR.stfPolicyEffectWarn} /> : null}

        <Divider />

        <Body style={{ fontWeight: "700" }}>{STR.stfPolicyProbation}</Body>
        <ChipRow>
          <Chip label={STR.stfYes} selected={probationOn} onPress={() => setProbationOn(true)} />
          <Chip label={STR.stfNo} selected={!probationOn} onPress={() => setProbationOn(false)} />
        </ChipRow>
        <Muted>{STR.stfPolicyProbationNote}</Muted>
      </Card>

      {/* --- lateness ------------------------------------------------------- */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfPolicyLateness}</Body>
        <Body>{STR.stfPolicyLatenessOn}</Body>
        <ChipRow>
          <Chip label={STR.stfYes} selected={latenessOn} onPress={() => setLatenessOn(true)} />
          <Chip label={STR.stfNo} selected={!latenessOn} onPress={() => setLatenessOn(false)} />
        </ChipRow>

        <Field
          label={STR.stfPolicyLateDays}
          value={lateDaysPerCharge}
          onChangeText={setLateDaysPerCharge}
          keyboardType="numeric"
        />

        {latenessOn ? (
          <Notice tone="warn" message={STR.stfPolicyLatenessNote} />
        ) : (
          <Muted>{STR.stfPolicyLatenessOffNote}</Muted>
        )}
      </Card>

      {/* --- letters -------------------------------------------------------- */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stfPolicyLetters}</Body>
        <Field label={STR.stfPolicySignatory} value={signatoryName} onChangeText={setSignatoryName} />
        <Field label={STR.stfPolicySignatoryTitle} value={signatoryTitle} onChangeText={setSignatoryTitle} />
        <Field label={STR.stfPolicyWeeklyHours} value={weeklyHoursText} onChangeText={setWeeklyHoursText} />
        <Field label={STR.stfPolicyRefPrefix} value={letterRefPrefix} onChangeText={setLetterRefPrefix} />
        <Muted>{STR.stfPolicyLettersNote}</Muted>
      </Card>

      <View style={{ marginTop: space(2) }}>
        <Button title={STR.save} loading={busy} disabled={!canSave} onPress={() => void onSave()} />
      </View>
    </Screen>
  );
}
