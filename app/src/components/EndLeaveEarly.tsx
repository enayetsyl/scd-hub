/**
 * EndLeaveEarly — "returned early" on a live leave card (owner 2026-10-18: Fida was on
 * leave to the 19th, rejoined on the 18th, and could not be given a proxy class because
 * every cover picker still read her as out). Pick the return date → the server ends the
 * leave the day before, re-stamps the paid/unpaid split, and releases the cover from that
 * date on. Shown on the admin leave list and on the applicant's own list (same gate as
 * cancel). Rendered inside a card's wrapping button row: closed it is one button, open it
 * takes the full row width.
 */
import React from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import { END_STAFF_LEAVE_EARLY, type StaffLeaveT } from "../graphql/operations";
import { Button, Muted } from "./ui";
import { DateField } from "./DateField";
import { STR, dhakaDateKey } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space } from "../theme/tokens";

/** The calendar day after a YYYY-MM-DD key. */
function nextDayKey(key: string): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Only a live, multi-day, whole-day leave can be shortened (a single date is a cancel). */
export function canEndLeaveEarly(a: StaffLeaveT): boolean {
  return (a.status === "applied" || a.status === "approved") && (a.dayPart ?? "full") === "full" && a.fromKey < a.toKey;
}

export function EndLeaveEarly({
  leave,
  disabled,
  onDone,
  onError,
}: {
  leave: StaffLeaveT;
  disabled?: boolean;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const min = nextDayKey(leave.fromKey);
  const today = dhakaDateKey();
  // Today is the usual answer; clamp it into the window for a leave not yet started or already over.
  const [returnKey, setReturnKey] = React.useState(today < min ? min : today > leave.toKey ? leave.toKey : today);
  const [, endEarly] = useMutation(END_STAFF_LEAVE_EARLY);

  if (!canEndLeaveEarly(leave)) return null;
  if (!open) {
    return <Button title={STR.hrLeaveEndEarly} variant="secondary" onPress={() => setOpen(true)} disabled={disabled} />;
  }

  const valid = returnKey >= min && returnKey <= leave.toKey;
  async function submit(): Promise<void> {
    setBusy(true);
    const res = await endEarly({ applicationId: leave.id, returnKey });
    setBusy(false);
    if (res.error || !res.data?.endStaffLeaveEarly) {
      onError(friendlyError(res.error));
      return;
    }
    setOpen(false);
    onDone(STR.hrLeaveEndedEarly);
  }

  return (
    <View style={{ width: "100%", marginTop: space(2) }}>
      <DateField
        label={STR.hrLeaveReturnDate}
        value={returnKey}
        onChange={setReturnKey}
        min={min}
        max={leave.toKey}
        helper={STR.hrLeaveEndEarlyHelp}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.hrLeaveEndEarlyConfirm} onPress={submit} loading={busy} disabled={busy || disabled || !valid} />
        <Button title={STR.cancel} variant="secondary" onPress={() => setOpen(false)} disabled={busy} />
      </View>
      {!valid ? <Muted>{STR.hrDateHint}</Muted> : null}
    </View>
  );
}
