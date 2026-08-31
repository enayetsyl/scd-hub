/**
 * ConfirmEmploymentScreen (SH-2; docs/prd-staff-hub.md, D-#540) — end probation.
 *
 * Confirming is not a field edit, and this screen is built to make that obvious: it
 * shows the LEDGER before the button is pressed. The held probation-leave days are
 * debited from the pool the person is about to be granted, and anything the pool cannot
 * absorb becomes a salary charge — so the Principal sees "10 allowance − 6 held = 4
 * remaining" rather than discovering it on a payslip a month later.
 *
 * The preview is a dry run (`confirmationPreview`); reading it settles nothing.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import {
  CONFIRMATION_PREVIEW_QUERY,
  CONFIRM_STAFF_EMPLOYMENT,
} from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Field,
  Chip,
  ChipRow,
  Button,
  Divider,
  Loader,
  Notice,
} from "../../components/ui";
import { STR, bnNum, employmentStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "ConfirmEmployment">;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-29" -> "29 August, 2026", the letters' own date format. */
function longDate(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return dateKey;
  return `${Number(m[3])} ${MONTHS_EN[idx]}, ${m[1]}`;
}

/**
 * The standard confirmation wording, offered as a DRAFT to edit (D-#590).
 *
 * It mirrors what the renderer falls back to when the box is left empty, so pressing
 * the button and pressing nothing produce the same letter — the difference is only
 * whether the issuer can see and change the words before they are frozen.
 */
export function defaultConfirmationBody(
  staff: { name: string; nameBn?: string | null; designation?: string | null; monthlySalary?: number | null },
  confirmationDate: string,
): string {
  const salary =
    staff.monthlySalary && staff.monthlySalary > 0
      ? ` Your monthly remuneration remains Tk. ${staff.monthlySalary.toLocaleString("en-US")}.`
      : "";
  return (
    `With reference to your service as ${staff.designation ?? ""} at the School for Community ` +
    `Development (SCD), the management is pleased to confirm your employment with effect from ` +
    `${longDate(confirmationDate)}, insha'Allah.${salary} All other terms and conditions of your ` +
    `appointment remain unchanged.`
  );
}

export default function ConfirmEmploymentScreen({ route, navigation }: Props): React.ReactElement {
  const { staff } = route.params;
  const [{ data, fetching }] = useQuery({
    query: CONFIRMATION_PREVIEW_QUERY,
    variables: { staffProfileId: staff.id },
  });
  const [, confirm] = useMutation(CONFIRM_STAFF_EMPLOYMENT);

  const [confirmationDate, setConfirmationDate] = React.useState(todayKey());
  const [extraText, setExtraText] = React.useState("");
  const [withLetter, setWithLetter] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  // Confirmed, but the letter did not come out (D-#574). Not a failure — a different
  // outcome, and one the operator has to see or she will assume a letter was filed.
  const [letterFailure, setLetterFailure] = React.useState<string | null>(null);

  const p = data?.confirmationPreview;
  const remainingAfter = p ? Math.max(0, p.poolRemaining - p.fromPool) : 0;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(confirmationDate);

  if (staff.confirmationDate) {
    return (
      <Screen scroll>
        <H2>{STR.stfConfirmTitle}</H2>
        <Notice tone="info" message={STR.stfAlreadyConfirmed} />
        <Button title={STR.close} variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  async function onConfirm(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await confirm({
      staffProfileId: staff.id,
      confirmationDate,
      extraText: extraText.trim() || null,
      issueLetter: withLetter,
    });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    const { letterId, letterError } = res.data.confirmStaffEmployment;
    if (letterError) {
      // Stay put. The confirmation stands and is audited; the letter can be issued
      // from কাগজপত্র once the reason is fixed.
      setLetterFailure(letterError);
      return;
    }
    if (letterId && PDF_SUPPORTED) await openPdf(`/pdf/staff-letter/${letterId}`);
    navigation.goBack();
  }

  if (letterFailure) {
    return (
      <Screen scroll>
        <H2>{`${STR.stfConfirmTitle} — ${staff.nameBn || staff.name}`}</H2>
        <Notice tone="ok" message={STR.stfConfirmedNoLetterOk} />
        <Notice tone="warn" message={`${STR.stfConfirmedNoLetter} ${letterFailure}`} />
        <Button title={STR.close} variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <H2>{`${STR.stfConfirmTitle} — ${staff.nameBn || staff.name}`}</H2>
      {failure ? <Notice tone="danger" message={failure} /> : null}

      <Card>
        <Field
          label={STR.stfConfirmDate}
          value={confirmationDate}
          onChangeText={setConfirmationDate}
          placeholder="YYYY-MM-DD"
        />
        <Muted>{STR.stfConfirmDateNote}</Muted>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfConfirmEffects}</Body>
        {fetching && !p ? (
          <Loader label={STR.loading} />
        ) : (
          <>
            <Row
              label={STR.stfConfirmStatusChange}
              value={`${employmentStatusLabel(staff.employmentStatus)} → ${employmentStatusLabel("confirmed")}`}
            />
            <Divider />
            <Row label={STR.stfConfirmPoolAllowance} value={`${bnNum(String(p?.poolRemaining ?? 0))} ${STR.stfDays}`} />
            <Row label={STR.stfConfirmHeldDeduct} value={`− ${bnNum(String(p?.fromPool ?? 0))} ${STR.stfDays}`} />
            <Divider />
            <Row label={STR.stfConfirmRemainingAfter} value={`${bnNum(String(remainingAfter))} ${STR.stfDays}`} />
            {p && p.toSalary > 0 ? (
              <Notice
                tone="warn"
                message={`${STR.stfConfirmExcessWarning} (${bnNum(String(p.toSalary))} ${STR.stfDays})`}
              />
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfConfirmIssueLetter}</Body>
        <ChipRow>
          <Chip label={STR.stfYes} selected={withLetter} onPress={() => setWithLetter(true)} />
          <Chip label={STR.stfNo} selected={!withLetter} onPress={() => setWithLetter(false)} />
        </ChipRow>
        {withLetter ? (
          <>
            {/* The WHOLE body, not an appendix (D-#590). What is typed here is what the
                letter says — the system adds nothing above or below it. The button
                below fills in the standard wording as a starting point; leaving the box
                empty prints that same wording. */}
            <Field
              label={STR.stfConfirmBody}
              value={extraText}
              onChangeText={setExtraText}
              placeholder={STR.stfConfirmBodyPlaceholder}
              multiline
            />
            <Button
              title={STR.stfConfirmBodyDraft}
              variant="secondary"
              onPress={() => setExtraText(defaultConfirmationBody(staff, confirmationDate))}
            />
          </>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Button title={STR.cancel} variant="secondary" onPress={() => navigation.goBack()} />
        <Button title={STR.stfConfirmAction} loading={busy} disabled={!dateOk} onPress={() => void onConfirm()} />
      </View>
    </Screen>
  );
}
