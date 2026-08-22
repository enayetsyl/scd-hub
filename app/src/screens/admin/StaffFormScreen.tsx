/**
 * StaffFormScreen — create or edit an HR staff record (D-#526).
 *
 * Until this screen a StaffProfile could only arrive through a developer-run import
 * script, which also meant a new employee could never be given a login (a login is
 * provisioned FROM a profile, D-#60). Reached from StaffListScreen: "নতুন কর্মী" for a
 * create, the row's edit button for an edit.
 *
 * PATCH semantics on edit — only fields the form actually shows are sent, and the server
 * leaves anything omitted alone. Pay is NOT here: salary and payment method are set under
 * `payroll:manage` through the payroll screens, a different permission from `staff:manage`.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { HR_CATEGORIES, EMPLOYMENT_TYPES, EMPLOYMENT_STATUSES } from "@scd/shared";
import {
  CREATE_STAFF_PROFILE,
  UPDATE_STAFF_PROFILE,
  type StaffProfileInputT,
  type StaffT,
} from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Muted,
  Field,
  Chip,
  ChipRow,
  Button,
  Divider,
  Notice,
  ErrorBanner,
} from "../../components/ui";
import {
  STR,
  hrCategoryLabel,
  employmentTypeLabel,
  employmentStatusLabel,
  genderLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "StaffForm">;

const GENDERS = ["male", "female", "other"] as const;

/** ISO timestamp → the YYYY-MM-DD the date fields expect. */
function dateInput(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function StaffFormScreen({ navigation, route }: Props): React.ReactElement {
  const existing = route.params?.staff as StaffT | undefined;
  const isEdit = !!existing;

  const [form, setForm] = useState<Record<string, string>>({
    schoolId: existing?.schoolId ?? "",
    name: existing?.name ?? "",
    nameBn: existing?.nameBn ?? "",
    category: existing?.category ?? "teacher",
    designation: existing?.designation ?? "",
    employmentType: existing?.employmentType ?? "full_time",
    employmentStatus: existing?.employmentStatus ?? "probation",
    joiningDate: dateInput(existing?.joiningDate),
    biometricId: existing?.biometricId ?? "",
    gender: existing?.gender ?? "",
    dob: dateInput(existing?.dob),
    bloodGroup: existing?.bloodGroup ?? "",
    maritalStatus: existing?.maritalStatus ?? "",
    qualification: existing?.qualification ?? "",
    fatherName: existing?.fatherName ?? "",
    motherName: existing?.motherName ?? "",
    spouseName: existing?.spouseName ?? "",
    phone: existing?.phone ?? "",
    whatsapp: existing?.whatsapp ?? "",
    email: existing?.email ?? "",
    presentAddress: existing?.presentAddress ?? "",
    permanentAddress: existing?.permanentAddress ?? "",
    nid: existing?.nid ?? "",
    bankAccount: existing?.bankAccount ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [, createStaff] = useMutation(CREATE_STAFF_PROFILE);
  const [, updateStaff] = useMutation(UPDATE_STAFF_PROFILE);

  const set = (k: string) => (v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  async function onSave(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const input = form as unknown as StaffProfileInputT;
    const res = isEdit
      ? await updateStaff({ staffProfileId: existing!.id, input })
      : await createStaff({ input });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setNotice(STR.saved);
    navigation.goBack();
  }

  const canSave =
    form.schoolId.trim() !== "" &&
    form.name.trim() !== "" &&
    form.category !== "" &&
    form.employmentType !== "" &&
    form.employmentStatus !== "";

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(2) }}>
        <H2>{isEdit ? STR.staffEdit : STR.staffNew}</H2>
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        <Field label={`${STR.staffId} *`} value={form.schoolId} onChangeText={set("schoolId")} />
        <Field label={`${STR.name} *`} value={form.name} onChangeText={set("name")} autoCapitalize="words" />
        <Field label={STR.nameBnLabel} value={form.nameBn} onChangeText={set("nameBn")} />
        <Field label={STR.designation} value={form.designation} onChangeText={set("designation")} />

        <Muted>{`${STR.category} *`}</Muted>
        <ChipRow>
          {HR_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={hrCategoryLabel(c)}
              selected={form.category === c}
              onPress={() => set("category")(c)}
            />
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

        <Muted>{`${STR.employmentStatus} *`}</Muted>
        <ChipRow>
          {EMPLOYMENT_STATUSES.map((c) => (
            <Chip
              key={c}
              label={employmentStatusLabel(c)}
              selected={form.employmentStatus === c}
              onPress={() => set("employmentStatus")(c)}
            />
          ))}
        </ChipRow>

        <Field label={STR.joiningDate} value={form.joiningDate} onChangeText={set("joiningDate")} placeholder="YYYY-MM-DD" />

        <Divider />
        {/* The phone is the LOGIN ID for a provisioned staff account (D-#60), so it is
            what makes the credentials screen able to mint one for this person. */}
        <Field label={STR.phone} value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
        <Field label={STR.whatsapp} value={form.whatsapp} onChangeText={set("whatsapp")} keyboardType="phone-pad" />
        <Field label={STR.email} value={form.email} onChangeText={set("email")} keyboardType="email-address" />

        <Muted>{STR.gender}</Muted>
        <ChipRow>
          {GENDERS.map((g) => (
            <Chip
              key={g}
              label={genderLabel(g)}
              selected={form.gender === g}
              onPress={() => set("gender")(form.gender === g ? "" : g)}
            />
          ))}
        </ChipRow>

        <Field label={STR.dob} value={form.dob} onChangeText={set("dob")} placeholder="YYYY-MM-DD" />
        <Field label={STR.bloodGroup} value={form.bloodGroup} onChangeText={set("bloodGroup")} />
        <Field label={STR.maritalStatus} value={form.maritalStatus} onChangeText={set("maritalStatus")} />
        <Field label={STR.qualification} value={form.qualification} onChangeText={set("qualification")} />
        <Field label={STR.fatherName} value={form.fatherName} onChangeText={set("fatherName")} />
        <Field label={STR.motherName} value={form.motherName} onChangeText={set("motherName")} />
        <Field label={STR.spouseName} value={form.spouseName} onChangeText={set("spouseName")} />
        <Field label={`${STR.address} (১)`} value={form.presentAddress} onChangeText={set("presentAddress")} multiline />
        <Field label={`${STR.address} (২)`} value={form.permanentAddress} onChangeText={set("permanentAddress")} multiline />

        <Divider />
        {/* Principal/Office-only rows (H1.4) — already behind the staff:manage gate. */}
        <Field label={STR.nid} value={form.nid} onChangeText={set("nid")} />
        <Field label={STR.bankAccount} value={form.bankAccount} onChangeText={set("bankAccount")} />
        <Field label={STR.biometricId} value={form.biometricId} onChangeText={set("biometricId")} />
        <Muted>{STR.staffPayElsewhere}</Muted>

        <View style={{ marginTop: space(3) }}>
          <Button title={STR.save} onPress={() => void onSave()} loading={busy} disabled={!canSave} />
        </View>
      </ScrollView>
    </Screen>
  );
}
