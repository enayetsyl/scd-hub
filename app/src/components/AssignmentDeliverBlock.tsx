/**
 * AssignmentDeliverBlock (DE-5, D-#477) — the week's assignment, handed out from
 * the period card it belongs to.
 *
 * Renders NOTHING unless `assignmentCellForSlot` says this period can deliver
 * today: same section and subject, not yet delivered, and the §4-resolved delivery
 * date is this date. That server read owns the whole term-anchor → week → cell
 * chain, so this component never has to know a week number.
 *
 * The roster is the existing `deliverAssignment` payload, prefilled from the day's
 * attendance (D-#325) and folded — on a day with attendance marked, delivery is one
 * tap. `AssignmentHomeScreen` remains the planning grid and the path for delivering
 * a week that was missed.
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  ASSIGNMENT_CELL_FOR_SLOT,
  DELIVER_ASSIGNMENT,
  HOMEWORK_ISSUE_ROSTER,
  STUDENTS_QUERY,
  type RoutineSlotT,
} from "../graphql/operations";
import { Body, Muted, Badge, Button, Field, Divider } from "./ui";
import { useAuth } from "../auth/AuthContext";
import { STR, bnNum, hwSubjectLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useToast } from "../state/ToastContext";
import { space } from "../theme/tokens";

export function AssignmentDeliverBlock({
  slot,
  date,
}: {
  slot: RoutineSlotT;
  date: string;
}): React.ReactElement | null {
  const toast = useToast();
  const { can } = useAuth();
  const eligible = slot.groupType === "section" && !!slot.classId && can("tracker:write");

  const [cellQ, refetchCell] = useQuery({
    query: ASSIGNMENT_CELL_FOR_SLOT,
    variables: { sectionId: slot.groupId, classId: slot.classId ?? "", subject: slot.subject, date },
    pause: !eligible,
  });
  const cell = cellQ.data?.assignmentCellForSlot ?? null;

  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId: slot.groupId }, pause: !cell });
  const students = (studentsQ.data?.studentsInSection ?? []).filter((s) => s.active);

  const [attRosterQ] = useQuery({
    query: HOMEWORK_ISSUE_ROSTER,
    variables: { sectionId: slot.groupId, classId: slot.classId ?? "", date },
    pause: !cell,
  });
  const attRoster = attRosterQ.data?.homeworkIssueRoster;

  const [absent, setAbsent] = useState<Record<string, boolean>>({});
  const touched = useRef(false);
  useEffect(() => {
    // D-#325: the delivery-date's absentees come pre-crossed off; a manual toggle
    // wins and stops further auto-fills.
    if (!attRoster?.complete || touched.current) return;
    const next: Record<string, boolean> = {};
    for (const e of attRoster.entries) if (!e.present) next[e.studentId] = true;
    setAbsent(next);
  }, [attRoster]);

  const [description, setDescription] = useState("");
  const [estMinutes, setEstMinutes] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [showRoster, setShowRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, deliver] = useMutation(DELIVER_ASSIGNMENT);

  if (!eligible || !cell) return null;

  const absentCount = students.filter((s) => absent[s.id]).length;

  async function onDeliver(): Promise<void> {
    if (!cell) return;
    // D-#478: the family reads this line — refuse an empty one before the round-trip.
    if (description.trim() === "") {
      toast.show(STR.asDescRequired, "danger");
      return;
    }
    if (students.length === 0) {
      toast.show(STR.empty, "danger");
      return;
    }
    setBusy(true);
    const res = await deliver({
      academicYearId: cell.academicYearId,
      weekNumber: cell.weekNumber,
      entryId: cell.entryId,
      sectionId: cell.sectionId,
      roster: students.map((s) => ({ studentId: s.id, present: !absent[s.id] })),
      description: description.trim(),
      estMinutes: estMinutes.trim() === "" ? undefined : parseInt(estMinutes, 10),
      totalMarks: totalMarks.trim() === "" ? undefined : parseInt(totalMarks, 10),
    });
    setBusy(false);
    if (res.error || !res.data?.deliverAssignment) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(`${res.data.deliverAssignment.asId} — ${STR.asDeliver}`, "ok");
    // The cell stops being deliverable once it exists, so the block disappears.
    refetchCell({ requestPolicy: "network-only" });
  }

  return (
    <View style={{ marginTop: space(3) }}>
      <Divider />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
        <Body style={{ fontWeight: "700", flex: 1 }}>{STR.cnWeekAssignment}</Body>
        <Badge text={`${STR.asDueBy} ${bnNum(cell.dueDate.slice(0, 10))}`} tone="warn" />
      </View>
      <Muted>{hwSubjectLabel(cell.subject)}</Muted>

      <Field label={STR.asDescLabel} value={description} onChangeText={setDescription} multiline />
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Field label={STR.asEstMinutes} value={estMinutes} onChangeText={setEstMinutes} keyboardType="number-pad" placeholder="20" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={STR.asTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
        </View>
      </View>

      <Pressable onPress={() => setShowRoster((v) => !v)} accessibilityRole="button">
        <Muted>
          {showRoster ? "▾" : "▸"} {STR.asPresent} {bnNum(students.length - absentCount)} · {STR.asAbsent}{" "}
          {bnNum(absentCount)}
          {attRoster?.complete ? ` · ✓ ${STR.hwRosterFromAttendance}` : ""}
        </Muted>
      </Pressable>
      {showRoster
        ? students.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                touched.current = true;
                setAbsent((m) => ({ ...m, [s.id]: !m[s.id] }));
              }}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 }}
            >
              <Body>
                {s.name} <Muted>({s.schoolId})</Muted>
              </Body>
              <Badge text={absent[s.id] ? STR.asAbsent : STR.asPresent} tone={absent[s.id] ? "warn" : "ok"} />
            </Pressable>
          ))
        : null}

      <Button
        title={STR.asDeliver}
        onPress={() => void onDeliver()}
        loading={busy}
        disabled={busy || students.length === 0}
        style={{ marginTop: space(2) }}
      />
    </View>
  );
}
