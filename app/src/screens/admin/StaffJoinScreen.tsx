/**
 * StaffJoinScreen (SH-6; docs/prd-staff-hub.md) — joining a teacher as ONE sequence.
 *
 * Before this, joining someone meant three unconnected stops: fill StaffFormScreen,
 * which `goBack()`s to the list; walk to প্রশাসন → স্টাফ লগইন and find the same person
 * again in a list of everyone; and there was no letter at all. This walks
 * তথ্য → বেতন → লগইন → নিয়োগপত্র and ends on that person's hub.
 *
 * EDITING IS NOT A WIZARD. `StaffFormScreen` stays exactly as it is for edits — nobody
 * should walk four steps to fix a phone number. This screen is create-only.
 *
 * PERMISSIONS. Office holds `staff:manage` AND `payroll:manage`, so steps 1, 2 and 4
 * are open to them; only step 3 (login) is Principal-only (`user:manage`). So step 3
 * DEGRADES to a waiting state and lets an Office user finish, rather than erroring or
 * silently vanishing — the record and the letter still get made today, and the
 * Principal mints the login later from the hub.
 */
import React from "react";
import { View } from "react-native";
import { Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AdminStackParamList } from "../../navigation/types";
import { HR_CATEGORIES, EMPLOYMENT_TYPES, PAYMENT_METHODS } from "@scd/shared";
import {
  CREATE_STAFF_PROFILE,
  STAFF_QUERY,
  UPDATE_STAFF_PROFILE,
  SET_STAFF_PAY,
  PROVISION_STAFF_LOGIN,
  ISSUE_STAFF_LETTER,
  type StaffProfileInputT,
  type ProvisionedCredentialT,
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
  Badge,
  Notice,
} from "../../components/ui";
import { STR, bnNum, hrCategoryLabel, employmentTypeLabel, paymentMethodLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import BankDetailsFields, {
  isBankDetailsComplete,
  EMPTY_BANK_DETAILS,
  type BankDetails,
} from "../../components/BankDetailsFields";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffJoin">;

const STEPS = [1, 2, 3, 4] as const;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Digits (and at most one decimal point) only. On web `keyboardType` is a hint, not a
 * restriction, so the field accepts anything typed into it. `Number("Tk. 6000,")` is
 * NaN, JSON serialises NaN as null, and the server reads null as "leave unchanged" —
 * so an unparsable salary used to save the payment method alone and look like success,
 * surfacing three steps later as a letter that refused to print (prod E2E, 2026-08-26).
 */
function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function Stepper({ step }: { step: number }): React.ReactElement {
  const labels = [STR.stfJoinStepInfo, STR.stfJoinStepPay, STR.stfJoinStepLogin, STR.stfJoinStepLetter];
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {STEPS.map((n, i) => (
          <View key={n} style={{ alignItems: "center", flex: 1 }}>
            <Badge
              text={step > n ? "✓" : bnNum(String(n))}
              tone={step === n ? "brand" : step > n ? "ok" : "muted"}
            />
            <Muted style={{ marginTop: space(1) }}>{labels[i]}</Muted>
          </View>
        ))}
      </View>
    </Card>
  );
}

export default function StaffJoinScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canProvision = can("user:manage");

  const [, createStaff] = useMutation(CREATE_STAFF_PROFILE);
  const [, setPay] = useMutation(SET_STAFF_PAY);
  const [, provision] = useMutation(PROVISION_STAFF_LOGIN);
  const [, issue] = useMutation(ISSUE_STAFF_LETTER);
  const [, updateStaff] = useMutation(UPDATE_STAFF_PROFILE);

  // The next id after the highest on record. Typed blind, this meant looking the last
  // one up elsewhere before you could even start.
  const [{ data: rosterData }] = useQuery({ query: STAFF_QUERY, variables: { category: null } });
  const suggestedId = React.useMemo(() => {
    const nums = (rosterData?.staff ?? [])
      .map((r) => Number(r.schoolId))
      .filter((n) => Number.isFinite(n));
    return nums.length ? String(Math.max(...nums) + 1) : "";
  }, [rosterData]);
  const [idTouched, setIdTouched] = React.useState(false);

  const [step, setStep] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  // step 1
  const [form, setForm] = React.useState<Record<string, string>>({
    schoolId: "",
    name: "",
    nameBn: "",
    designation: "",
    category: "teacher",
    employmentType: "full_time",
    joiningDate: todayKey(),
    phone: "",
    whatsapp: "",
    email: "",
    presentAddress: "",
  });
  const set = (k: string) => (v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  React.useEffect(() => {
    if (!suggestedId || idTouched) return;
    setForm((prev) => (prev.schoolId === "" ? { ...prev, schoolId: suggestedId } : prev));
  }, [suggestedId, idTouched]);

  // created record
  const [staffId, setStaffId] = React.useState<string | null>(null);

  // step 2
  const [salary, setSalary] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState("bank");
  const [bank, setBank] = React.useState<BankDetails>(EMPTY_BANK_DETAILS);
  const [bankTouched, setBankTouched] = React.useState(false);

  // step 3
  const [cred, setCred] = React.useState<ProvisionedCredentialT | null>(null);
  const [copied, setCopied] = React.useState(false);

  // step 4
  const [salaryMode, setSalaryMode] = React.useState<"paid" | "honorary">("paid");
  const [extraText, setExtraText] = React.useState("");

  /**
   * পদবি is REQUIRED here even though the model allows it to be absent, because step ৪
   * cannot issue a letter without it — `issueLetter` refuses, since it is what clause 5
   * prints. Letting step ১ past a field step ৪ needs just moves the failure three
   * screens away from the mistake (owner, prod test 2026-08-26).
   */
  const step1Ok =
    form.schoolId.trim() !== "" &&
    form.name.trim() !== "" &&
    form.designation.trim() !== "" &&
    form.category !== "" &&
    form.employmentType !== "";

  async function submitStep1(): Promise<void> {
    setBusy(true);
    setFailure(null);
    // A new joiner ALWAYS starts on probation — the confirmation date is set later,
    // from the hub, because it is an event with a settlement attached (D-#540).
    const input = { ...form, employmentStatus: "probation" } as unknown as StaffProfileInputT;
    // Coming BACK to step ১ and going forward again must EDIT the record, never create a
    // second one — otherwise the button that fixes a typo silently duplicates the staff
    // member. `staffId` is the whole test: set means it already exists.
    const res = staffId
      ? await updateStaff({ staffProfileId: staffId, input })
      : await createStaff({ input });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    if (!staffId && "createStaffProfile" in res.data) {
      setStaffId((res.data as { createStaffProfile: { id: string } }).createStaffProfile.id);
    }
    setStep(2);
  }

  async function submitStep2(skip: boolean): Promise<void> {
    const amount = parseAmount(salary);
    if (!skip && salary.trim() !== "" && amount === null) {
      setFailure(STR.stfSalaryNotANumber);
      return;
    }
    // A payment method with no details cannot be paid into, and the disbursement file
    // exists to carry exactly those details — so this blocks rather than warns.
    if (!skip && salary.trim() !== "" && !isBankDetailsComplete(paymentMethod, bank)) {
      setBankTouched(true);
      setFailure(STR.stfBankDetailsRequired);
      return;
    }
    if (skip || !salary.trim()) {
      // No salary means no PAID appointment letter, so the letter step defaults to
      // honorary rather than presenting a choice that would only be refused.
      setSalaryMode("honorary");
      setStep(3);
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await setPay({
      staffProfileId: staffId!,
      monthlySalary: amount,
      paymentMethod,
    });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    if (paymentMethod !== "cash") {
      const upd = await updateStaff({
        staffProfileId: staffId!,
        input: {
          bankAccount: bank.bankAccount.trim(),
          bankAccountName: bank.bankAccountName.trim(),
          bankName: bank.bankName.trim(),
          bankBranch: bank.bankBranch.trim(),
        },
      });
      if (upd.error) {
        setFailure(friendlyError(upd.error));
        return;
      }
    }
    setStep(3);
  }

  async function submitStep3(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const res = await provision({ staffProfileId: staffId! });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    setCred(res.data.provisionStaffLogin);
  }

  async function submitStep4(skip: boolean): Promise<void> {
    if (skip) {
      navigation.goBack();
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await issue({
      staffProfileId: staffId!,
      kind: "appointment",
      effectiveFrom: form.joiningDate || todayKey(),
      salaryMode,
      monthlySalary: salaryMode === "paid" ? Number(salary) : null,
      designation: form.designation.trim() || null,
      extraText: extraText.trim() || null,
    });
    setBusy(false);
    if (res.error || !res.data) {
      setFailure(friendlyError(res.error));
      return;
    }
    if (PDF_SUPPORTED) await openPdf(`/pdf/staff-letter/${res.data.issueStaffLetter.id}`);
    navigation.goBack();
  }

  return (
    <Screen scroll>
      <H2>{STR.stfJoinTitle}</H2>
      <Muted>{`${STR.stfJoinStep} ${bnNum(String(step))} / ${bnNum("4")}`}</Muted>
      <Stepper step={step} />
      {failure ? <Notice tone="danger" message={failure} /> : null}

      {step === 1 ? (
        <>
          <Card>
            <Field
              label={`${STR.staffId} *`}
              value={form.schoolId}
              onChangeText={(v) => { setIdTouched(true); set("schoolId")(v); }}
            />
            {suggestedId && !idTouched ? <Muted>{STR.stfIdSuggested}</Muted> : null}
            <Field label={`${STR.name} *`} value={form.name} onChangeText={set("name")} autoCapitalize="words" />
            <Field label={STR.nameBnLabel} value={form.nameBn} onChangeText={set("nameBn")} />
            <Field label={`${STR.designation} *`} value={form.designation} onChangeText={set("designation")} />
            <Muted style={{ marginTop: -space(2), marginBottom: space(3) }}>{STR.stfJoinDesignationForLetter}</Muted>

            <Muted>{`${STR.category} *`}</Muted>
            <ChipRow>
              {HR_CATEGORIES.map((c) => (
                <Chip key={c} label={hrCategoryLabel(c)} selected={form.category === c} onPress={() => set("category")(c)} />
              ))}
            </ChipRow>

            <Muted>{`${STR.employmentType} *`}</Muted>
            <ChipRow>
              {EMPLOYMENT_TYPES.map((c) => (
                <Chip
                  key={c}
                  label={employmentTypeLabel(c)}
                  selected={form.employmentType === c}
                  onPress={() => set("employmentType")(c)}
                />
              ))}
            </ChipRow>

            <Field label={STR.joiningDate} value={form.joiningDate} onChangeText={set("joiningDate")} placeholder="YYYY-MM-DD" />
            <Notice tone="info" message={STR.stfJoinProbationNote} />
          </Card>

          <Card>
            <Field label={STR.phone} value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
            <Muted style={{ marginTop: -space(2), marginBottom: space(3) }}>{STR.stfJoinPhoneIsLogin}</Muted>
            <Field label={STR.whatsapp} value={form.whatsapp} onChangeText={set("whatsapp")} keyboardType="phone-pad" />
            <Field label={STR.email} value={form.email} onChangeText={set("email")} keyboardType="email-address" />
            <Field label={STR.stfPresentAddress} value={form.presentAddress} onChangeText={set("presentAddress")} multiline />
            <Muted>{STR.stfJoinAddressForLetter}</Muted>
          </Card>

          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title={STR.cancel} variant="secondary" onPress={() => navigation.goBack()} />
            <Button
              title={`${STR.stfJoinNext}: ${STR.stfJoinStepPay}`}
              loading={busy}
              disabled={!step1Ok}
              onPress={() => void submitStep1()}
            />
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card>
            <Field label={STR.stfMonthlySalary} value={salary} onChangeText={setSalary} keyboardType="numeric" />
            <Muted>{STR.stfSalaryDigitsOnly}</Muted>
            <Muted>{STR.stfPaymentMethod}</Muted>
            <ChipRow>
              {PAYMENT_METHODS.map((m) => (
                <Chip key={m} label={paymentMethodLabel(m)} selected={paymentMethod === m} onPress={() => setPaymentMethod(m)} />
              ))}
            </ChipRow>
            <BankDetailsFields
              method={paymentMethod}
              value={bank}
              onChange={setBank}
              showIncompleteWarning={bankTouched}
            />
            <Muted>{STR.stfJoinSalaryNote}</Muted>
          </Card>
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.stfBack} variant="secondary" onPress={() => setStep(1)} />
            <Button title={STR.stfJoinNoPaySkip} variant="secondary" onPress={() => void submitStep2(true)} />
            <Button
              title={`${STR.stfJoinNext}: ${STR.stfJoinStepLogin}`}
              loading={busy}
              onPress={() => void submitStep2(false)}
            />
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          {canProvision ? (
            <Card>
              {cred ? (
                <>
                  <Row label={STR.loginId} value={cred.identifier} />
                  <Row label={STR.stfRoleAssigned} value={cred.contextLabel} />
                  <Row label={STR.generatedPassword} value={cred.password} />
                  <Notice tone="warn" message={STR.credentialOnceWarning} />
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Button title={STR.shareWhatsApp} onPress={() => Linking.openURL(cred.waLink)} />
                    <Button
                      title={copied ? STR.copied : STR.copy}
                      variant="secondary"
                      onPress={() => {
                        void Clipboard.setStringAsync(`${STR.loginId}: ${cred.identifier}\n${STR.generatedPassword}: ${cred.password}`);
                        setCopied(true);
                      }}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Row label={STR.stfJoinLoginWillBe} value={form.phone || "—"} />
                  <Button
                    title={STR.generateLogin}
                    loading={busy}
                    disabled={!form.phone.trim()}
                    onPress={() => void submitStep3()}
                    style={{ marginTop: space(2) }}
                  />
                </>
              )}
            </Card>
          ) : (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.stfJoinLoginPrincipalOnly}</Body>
              <Muted>{STR.stfJoinLoginPending}</Muted>
              <Divider />
              <Row label={STR.stfJoinLoginWillBe} value={form.phone || "—"} />
              <Row label={STR.employmentStatus} value={STR.stfJoinWaitingPrincipal} />
            </Card>
          )}
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.stfBack} variant="secondary" onPress={() => setStep(2)} />
            <Button title={STR.stfJoinSkipStep} variant="secondary" onPress={() => setStep(4)} />
            <Button title={`${STR.stfJoinNext}: ${STR.stfJoinStepLetter}`} onPress={() => setStep(4)} />
          </View>
        </>
      ) : null}

      {step === 4 ? (
        <>
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
            {salaryMode === "paid" && !salary.trim() ? (
              <Notice tone="warn" message={STR.stfJoinSalaryNote} />
            ) : null}
            <Field
              label={STR.stfExtraText}
              value={extraText}
              onChangeText={setExtraText}
              placeholder={STR.stfExtraTextPlaceholder}
              multiline
            />
          </Card>
          <Notice tone="warn" message={STR.stfIssueWarning} />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button title={STR.stfBack} variant="secondary" onPress={() => setStep(3)} />
            <Button title={STR.stfJoinFinish} variant="secondary" onPress={() => void submitStep4(true)} />
            <Button
              title={STR.stfIssueAndPdf}
              loading={busy}
              disabled={salaryMode === "paid" && !salary.trim()}
              onPress={() => void submitStep4(false)}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
