/**
 * IssueLetterScreen (SH-1; docs/prd-staff-hub.md, D-#542) — issue one letter.
 *
 * The paid/honorary choice is the whole point of this screen. The source .docx carries
 * BOTH clause 1 (a salary figure) and clause 2 ("you would serve as an honorary teacher
 * … no remuneration"), which is a copy-paste artefact rather than a document anyone can
 * sign. Here the issuer picks one, and only that clause is printed.
 *
 * The designation is pre-filled from the profile but editable, because it is what
 * clause 6 prints — the template's stray "your duties as a principal" on a Junior
 * Teacher's letter is exactly what happens when nobody looks at that field.
 *
 * Issuing FREEZES every merge field into the letter's snapshot, so this form is the
 * last moment any of it can be changed. That is said on the screen, not just in a doc.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import {
  ISSUE_STAFF_LETTER,
  HR_POLICY_QUERY,
  SUPPORT_CONTRACT_DEFAULTS_QUERY,
} from "../../graphql/operations";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Row,
  Field,
  Select,
  Chip,
  ChipRow,
  Button,
  Divider,
  Notice,
} from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "IssueLetter">;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Digits only. `keyboardType` is a hint on web, not a restriction — an unparsable
 * salary becomes NaN, serialises to null and reaches the server as "not provided",
 * which is how a letter came to promise a figure the record never stored.
 */
function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function kindLabel(kind: string): string {
  if (kind === "appointment") return STR.stfLetterAppointment;
  if (kind === "confirmation") return STR.stfLetterConfirmation;
  if (kind === "support_contract") return STR.stfLetterContract;
  return STR.stfLetterCertificate;
}

export default function IssueLetterScreen({ route, navigation }: Props): React.ReactElement {
  const { staff, kind } = route.params;
  const [{ data: policy }] = useQuery({ query: HR_POLICY_QUERY });
  const [, issue] = useMutation(ISSUE_STAFF_LETTER);

  // Honorary is the honest default when no salary is on record: offering "paid" first
  // to a staff member with no figure would only produce a refusal at submit.
  const hasSalary = (staff.monthlySalary ?? 0) > 0;
  const [salaryMode, setSalaryMode] = React.useState<"paid" | "honorary">(hasSalary ? "paid" : "honorary");
  const [letterDate, setLetterDate] = React.useState(todayKey());
  const [effectiveFrom, setEffectiveFrom] = React.useState(staff.joiningDate?.slice(0, 10) ?? todayKey());
  const [designation, setDesignation] = React.useState(staff.designation ?? "");
  const [salary, setSalary] = React.useState(staff.monthlySalary != null ? String(staff.monthlySalary) : "");
  const [weeklyHours, setWeeklyHours] = React.useState("");
  const [extraText, setExtraText] = React.useState("");
  // The Bangla contract (D-#586). `role` picks which default duties schedule loads;
  // the operator then edits the text, and it is the EDITED text that is issued.
  const [role, setRole] = React.useState<string>("helper");
  const [duties, setDuties] = React.useState("");
  const [hoursBn, setHoursBn] = React.useState("");
  const [foodAllowance, setFoodAllowance] = React.useState("");
  const [permanentBn, setPermanentBn] = React.useState("");
  const [presentBn, setPresentBn] = React.useState("");
  const [contactBn, setContactBn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const isCertificate = kind === "service_certificate";
  const isContract = kind === "support_contract";

  const [{ data: defaults }] = useQuery({
    query: SUPPORT_CONTRACT_DEFAULTS_QUERY,
    variables: { role },
    pause: !isContract,
  });

  // Loading a role's defaults REPLACES the draft — switching খালা → দারোয়ান must not
  // leave the previous role's duties behind. Anything typed after that is kept.
  const loadedRole = React.useRef<string | null>(null);
  React.useEffect(() => {
    const d = defaults?.supportContractDefaults;
    if (!d || loadedRole.current === d.role) return;
    loadedRole.current = d.role;
    setDuties(d.dutiesBn.join("\n"));
    setHoursBn(d.workingHoursBn);
  }, [defaults]);

  const p = policy?.hrPolicy;
  const canSubmit =
    designation.trim() !== "" &&
    /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(letterDate) &&
    (salaryMode === "honorary" || parseAmount(salary) !== null) &&
    // A contract with no duties is not a contract; the server refuses it, so the
    // button refuses first rather than sending a request that can only fail.
    (!isContract || duties.split("\n").some((d) => d.trim() !== ""));

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await issue({
      staffProfileId: staff.id,
      kind,
      effectiveFrom,
      salaryMode,
      letterDate,
      monthlySalary: salaryMode === "paid" ? parseAmount(salary) : null,
      designation: designation.trim(),
      weeklyHours: weeklyHours.trim() || null,
      extraText: extraText.trim() || null,
      contract: isContract
        ? {
            role,
            // One duty per line — the textarea IS the schedule.
            dutiesBn: duties.split("\n").map((d) => d.trim()).filter(Boolean),
            workingHoursBn: hoursBn.trim(),
            foodAllowance: parseAmount(foodAllowance),
            permanentAddressBn: permanentBn.trim() || null,
            presentAddressBn: presentBn.trim() || null,
            contactBn: contactBn.trim() || null,
          }
        : null,
    });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    const letterId = res.data.issueStaffLetter.id;
    if (PDF_SUPPORTED) await openPdf(`/pdf/staff-letter/${letterId}`);
    navigation.goBack();
  }

  return (
    <Screen scroll>
      <H2>{`${kindLabel(kind)} — ${staff.nameBn || staff.name}`}</H2>
      {failure ? <Notice tone="danger" message={failure} /> : null}

      {kind === "appointment" ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfSalaryMode}</Body>
          <ChipRow>
            <Chip
              label={STR.stfSalaryModePaid}
              selected={salaryMode === "paid"}
              onPress={() => setSalaryMode("paid")}
            />
            <Chip
              label={STR.stfSalaryModeHonorary}
              selected={salaryMode === "honorary"}
              onPress={() => setSalaryMode("honorary")}
            />
          </ChipRow>
          <Muted>{STR.stfSalaryModeNote}</Muted>
          {salaryMode === "paid" && parseAmount(salary) === null ? (
            <Notice tone="warn" message={STR.stfJoinSalaryNote} />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Field label={STR.designation} value={designation} onChangeText={setDesignation} />
        <Muted style={{ marginTop: -space(2), marginBottom: space(3) }}>{STR.stfJoinDesignationForLetter}</Muted>

        {/* A service certificate has no "effective from": it certifies a period the
            record already knows (joining date → the offboarding case's last working
            day, D-#583). The field was collected, ignored, and printed nowhere. */}
        {isCertificate ? null : (
          <Field label={STR.stfEffectiveFrom} value={effectiveFrom} onChangeText={setEffectiveFrom} placeholder="YYYY-MM-DD" />
        )}
        <Field label={STR.stfLetterDate} value={letterDate} onChangeText={setLetterDate} placeholder="YYYY-MM-DD" />

        {salaryMode === "paid" && kind !== "service_certificate" ? (
          <Field label={STR.stfMonthlySalary} value={salary} onChangeText={setSalary} keyboardType="numeric" />
        ) : null}

        {kind === "appointment" ? (
          <Field
            label={STR.stfWeeklyHours}
            value={weeklyHours}
            onChangeText={setWeeklyHours}
            placeholder={p?.weeklyHoursText ?? "25 (5*5)"}
          />
        ) : null}
      </Card>

      {isContract ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfContractSection}</Body>
          {!p?.employerNameBn || !p?.signatoryNameBn ? (
            <Notice tone="warn" message={STR.stfContractPolicyMissing} />
          ) : null}
          <Select
            label={STR.stfContractRole}
            value={role}
            options={[
              { label: STR.stfContractRoleHelper, value: "helper" },
              { label: STR.stfContractRoleGuard, value: "guard" },
            ]}
            onChange={(v) => setRole(v ?? "helper")}
          />
          <Field label={STR.stfContractHours} value={hoursBn} onChangeText={setHoursBn} multiline />
          <Field label={STR.stfContractDuties} value={duties} onChangeText={setDuties} multiline />
          <Muted style={{ marginTop: -space(2), marginBottom: space(3) }}>{STR.stfContractDutiesHint}</Muted>
          <Field
            label={STR.stfContractFood}
            value={foodAllowance}
            onChangeText={setFoodAllowance}
            keyboardType="numeric"
            placeholder={STR.stfContractFoodHint}
          />
          <Field label={STR.stfContractPermanent} value={permanentBn} onChangeText={setPermanentBn} multiline />
          <Field label={STR.stfContractPresent} value={presentBn} onChangeText={setPresentBn} multiline />
          <Field label={STR.stfContractContact} value={contactBn} onChangeText={setContactBn} />
        </Card>
      ) : null}

      {p ? (
        <Card>
          {/* The leave allowance is shown because the APPOINTMENT letter's clause 7
              prints it. A service certificate mentions no leave at all, so showing the
              pool there just invited the question "why does a certificate care?"
              (D-#583). The signatory applies to every letter and stays. */}
          {isCertificate ? null : (
            <>
              <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stfLeavePool}</Body>
              <Row label={STR.stfPoolAllowance} value={`${bnNum(String(p.annualLeaveDays))} ${STR.stfDays}`} />
            </>
          )}
          {/* The contract is signed by the Bangla signatory, not the English letters'
              convener — so show the name that will actually be on it (D-#590). */}
          <Row
            label={STR.stfIssuedBy}
            value={
              isContract
                ? `${p.signatoryNameBn || "—"} · ${p.signatoryTitleBn || "—"}`
                : `${p.signatoryName} · ${p.signatoryTitle}`
            }
          />
        </Card>
      ) : null}

      <Card>
        <Field
          label={STR.stfExtraText}
          value={extraText}
          onChangeText={setExtraText}
          placeholder={STR.stfExtraTextPlaceholder}
          multiline
        />
      </Card>

      <Notice tone="warn" message={STR.stfIssueWarning} />
      <Divider />
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Button title={STR.cancel} variant="secondary" onPress={() => navigation.goBack()} />
        <Button title={STR.stfIssueAndPdf} loading={busy} disabled={!canSubmit} onPress={() => void onSubmit()} />
      </View>
    </Screen>
  );
}
