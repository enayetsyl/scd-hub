/**
 * SendToPrintCard — the office print-queue form (colour · sides · copies · use
 * date) folded out of a "send to print" button.
 *
 * Extracted here at TN-3 because this form was about to exist a third time. It
 * is deliberately PRESENTATIONAL: it owns the field state and the validity rule
 * and hands the finished options to `onSend`, so each caller keeps its own
 * mutation and its own success wording. The English Drive screen still has its
 * own inline copy — folding that one in is a separate change, not a rider on
 * this feature.
 *
 * The use date is mandatory: the office queue needs to know WHEN a print is
 * used, and for a per-class-present job it also picks the attendance day.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import {
  PRINT_COLOURS,
  PRINT_SIDES,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES_LABELS_EN,
} from "@scd/shared";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../graphql/operations";
import { Body, Muted, Button, Chip, ChipRow, Field, Notice } from "./ui";
import { DateField } from "./DateField";
import { STR, classLevelLabel } from "../lib/labels";
import { printTargets, type PrintTarget } from "../lib/sectionPicks";
import { space } from "../theme/tokens";

export interface PrintOptions {
  colour: string;
  sides: string;
  copies: number;
  copiesMode: "FIXED" | "CLASS_PRESENT";
  copiesClassId: string | null;
  /** D-#721: who the print is FOR — tags the job; a per-present count follows it. */
  classId: string | null;
  sectionId: string | null;
  neededByKey: string;
}

interface Props {
  /** Runs the caller's own mutation. Resolve with an error string, or null on success. */
  onSend: (opts: PrintOptions) => Promise<string | null>;
  /** Shown after a successful send. */
  successMessage: string;
  disabled?: boolean;
  /** The document's own class level: its target is pre-picked when the class has one
   *  section (a split class still asks বালক or বালিকা). */
  classLevel?: number | null;
}

/** "৪র্থ শ্রেণি বালক" — the chip label for a print-for target. */
export const printTargetLabel = (t: PrintTarget): string =>
  `${classLevelLabel(t.classLevel)}${t.sectionNameBn ? ` ${t.sectionNameBn}` : ""}`;

export default function SendToPrintCard({
  onSend,
  successMessage,
  disabled,
  classLevel,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  const [copies, setCopies] = useState("1");
  const [copiesMode, setCopiesMode] = useState<"FIXED" | "CLASS_PRESENT">("FIXED");
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [neededByKey, setNeededByKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Class chips for a per-class-present job — current academic year.
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId =
    yearsQ.data?.academicYears?.find((y) => y.current)?.id ??
    yearsQ.data?.academicYears?.[0]?.id ??
    null;
  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: yearId ?? "" },
    pause: !yearId,
  });
  // One chip per class, or per section where the class is split (D-#721).
  const targets = printTargets(classesQ.data?.classes ?? []);
  const target = targets.find((t) => t.key === targetKey) ?? null;
  const ownTargets = classLevel == null ? [] : targets.filter((t) => t.classLevel === classLevel);
  const soleOwnKey = ownTargets.length === 1 ? ownTargets[0].key : null;
  React.useEffect(() => {
    if (soleOwnKey && targetKey === null) setTargetKey(soleOwnKey);
  }, [soleOwnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Number(copies);
  const valid =
    !!colour &&
    !!sides &&
    !!neededByKey &&
    !!target &&
    (copiesMode === "FIXED" ? Number.isInteger(n) && n >= 1 : true);

  async function submit(): Promise<void> {
    if (busy || !valid || !colour || !sides || !target) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    const failure = await onSend({
      colour,
      sides,
      // A per-class-present job resolves the real count from attendance at print time.
      copies: copiesMode === "FIXED" ? n : 1,
      copiesMode,
      copiesClassId: copiesMode === "CLASS_PRESENT" ? target.classId : null,
      classId: target.classId,
      sectionId: target.sectionId,
      neededByKey,
    });
    setBusy(false);
    if (failure) {
      setErr(failure);
      return;
    }
    setOk(successMessage);
    setOpen(false);
  }

  return (
    <View>
      {!open ? (
        <Button
          title={`🖨️ ${STR.cqSendToPrint}`}
          variant="secondary"
          disabled={busy || disabled}
          onPress={() => {
            setOpen(true);
            setOk(null);
          }}
        />
      ) : (
        <>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.prColour} *</Body>
          <ChipRow>
            {PRINT_COLOURS.map((c) => (
              <Chip
                key={c}
                label={PRINT_COLOUR_LABELS_EN[c]}
                selected={colour === c}
                onPress={() => setColour(c)}
              />
            ))}
          </ChipRow>

          <Body style={{ fontWeight: "700", marginVertical: space(1) }}>{STR.prSides} *</Body>
          <ChipRow>
            {PRINT_SIDES.map((sd) => (
              <Chip
                key={sd}
                label={PRINT_SIDES_LABELS_EN[sd]}
                selected={sides === sd}
                onPress={() => setSides(sd)}
              />
            ))}
          </ChipRow>

          <Body style={{ fontWeight: "700", marginVertical: space(1) }}>{STR.prPrintFor} *</Body>
          <ChipRow>
            {targets.map((t) => (
              <Chip
                key={t.key}
                label={printTargetLabel(t)}
                selected={targetKey === t.key}
                onPress={() => setTargetKey(t.key)}
              />
            ))}
          </ChipRow>

          <Body style={{ fontWeight: "700", marginVertical: space(1) }}>{STR.prCopies} *</Body>
          <ChipRow>
            <Chip
              label={STR.prCopiesFixed}
              selected={copiesMode === "FIXED"}
              onPress={() => setCopiesMode("FIXED")}
            />
            <Chip
              label={STR.prCopiesClass}
              selected={copiesMode === "CLASS_PRESENT"}
              onPress={() => setCopiesMode("CLASS_PRESENT")}
            />
          </ChipRow>
          {copiesMode === "FIXED" ? (
            <Field
              label={STR.prCopies}
              value={copies}
              onChangeText={setCopies}
              keyboardType="number-pad"
            />
          ) : (
            // The count follows the print-for pick above — its class, or its section.
            <Muted style={{ marginTop: space(1) }}>
              {target?.sectionNameBn ? STR.prCopiesSectionOnly : STR.prCopiesPresentHint}
            </Muted>
          )}

          <DateField label={`${STR.prUseDate} *`} value={neededByKey} onChange={setNeededByKey} />

          <Button
            title={STR.cqSendToPrint}
            onPress={() => void submit()}
            loading={busy}
            disabled={busy || !valid}
            style={{ marginTop: space(1) }}
          />
        </>
      )}
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}
    </View>
  );
}
