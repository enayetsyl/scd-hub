/**
 * ClassTestResultsScreen (CT-5 / J3, tracker:write) — the per-student entry grid for
 * one printed exam. Pick a student → PRESENT (+ marks) or ABSENT, plus weakness +
 * teacher-action (internal) + guardian-action; %/pass-fail are DERIVED server-side
 * (D-#85). Prior results prefill the form. enterClassTestResult rides tracker:write +
 * the server section verify (only on/after the exam date) — the Bangla deny surfaces
 * inline. → Publish for the same exam.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  CLASS_TEST_QUERY,
  CLASS_TEST_ROSTER_QUERY,
  CLASS_TEST_RESULTS_QUERY,
  ENTER_CLASS_TEST_RESULT,
  RETIRE_CLASS_TEST,
  RESTORE_CLASS_TEST,
  UPDATE_CLASS_TEST_DETAILS,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Chip, Field, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, ctUnitLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestResults">;
type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function ClassTestResultsScreen({ route }: Props): React.ReactElement {
  const { testId, title } = route.params;
  const nav = useNavigation<Nav>();
  const toast = useToast();
  // Admin viewer (Principal/Office — the house roster:manage check): sees the
  // teacher's comment texts read-only per student (owner ask 2026-07-21).
  const { role, user, can } = useAuth();
  const isAdmin = can("roster:manage");

  const [testQ, refetchTest] = useQuery({ query: CLASS_TEST_QUERY, variables: { id: testId } });
  const test = testQ.data?.classTest ?? null;
  // D-#507: the exam's OWN roster — the section's students, or the Arabic group's
  // members. `studentsInSection` cannot answer for a group exam: its students come
  // from several sections, so the server resolves the roster per anchor instead.
  const [studentsQ] = useQuery({ query: CLASS_TEST_ROSTER_QUERY, variables: { testId }, pause: !test });
  const students = studentsQ.data?.classTestRoster ?? [];
  const [resultsQ, refetch] = useQuery({ query: CLASS_TEST_RESULTS_QUERY, variables: { testId } });
  const results = resultsQ.data?.classTestResults ?? [];
  const byStudent = useMemo(() => {
    const m = new Map<string, (typeof results)[number]>();
    for (const r of results) m.set(r.studentId, r);
    return m;
  }, [results]);

  // Who may correct the details: Principal/Office, or the exam's OWN teacher — the
  // accountable subject teacher or whoever filed it (the same "mine" listMyClassTests
  // uses). The server enforces this too; this only decides whether the button shows.
  const canEditDetails =
    isAdmin || (!!user && !!test && (test.teacherId === user.id || test.requestedBy === user.id));

  const [, enter] = useMutation(ENTER_CLASS_TEST_RESULT);
  const [, retire] = useMutation(RETIRE_CLASS_TEST);
  const [, restore] = useMutation(RESTORE_CLASS_TEST);
  const [, updateDetails] = useMutation(UPDATE_CLASS_TEST_DETAILS);

  // Edit details — admin, or the exam's OWN teacher (accountable subject teacher, or
  // whoever filed it: the same "mine" the my-class-tests list uses).
  const [editOpen, setEditOpen] = useState(false);
  const [editTotal, setEditTotal] = useState("");
  const [editPass, setEditPass] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  async function onSaveDetails(): Promise<void> {
    setError(null);
    setEditBusy(true);
    const res = await updateDetails({
      id: testId,
      totalMarks: editTotal.trim() ? Number(editTotal) : null,
      passMark: editPass.trim() ? Number(editPass) : null,
    });
    setEditBusy(false);
    if (res.error || !res.data?.updateClassTestDetails) return setError(friendlyError(res.error));
    setEditOpen(false);
    toast.show(STR.ctEditSaved, "ok");
    refetchTest({ requestPolicy: "network-only" });
  }

  // Retire / restore (Principal/Office) — see the buttons below.
  const [retireOpen, setRetireOpen] = useState(false);
  const [retireReason, setRetireReason] = useState("");
  const [retireBusy, setRetireBusy] = useState(false);

  async function onRetire(): Promise<void> {
    setError(null);
    setRetireBusy(true);
    const res = await retire({ id: testId, reason: retireReason.trim() });
    setRetireBusy(false);
    if (res.error || !res.data?.retireClassTest) return setError(friendlyError(res.error));
    setRetireOpen(false);
    setRetireReason("");
    refetchTest({ requestPolicy: "network-only" });
    nav.goBack();
  }

  async function onRestore(): Promise<void> {
    setError(null);
    setRetireBusy(true);
    const res = await restore({ id: testId });
    setRetireBusy(false);
    if (res.error || !res.data?.restoreClassTest) return setError(friendlyError(res.error));
    refetchTest({ requestPolicy: "network-only" });
  }

  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<"PRESENT" | "ABSENT">("PRESENT");
  const [marks, setMarks] = useState("");
  const [weakness, setWeakness] = useState("");
  const [teacherAction, setTeacherAction] = useState("");
  const [guardianAction, setGuardianAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openStudent(studentId: string): void {
    setError(null);
    const existing = byStudent.get(studentId);
    setOpenId(studentId);
    setStatus((existing?.status as "PRESENT" | "ABSENT") ?? "PRESENT");
    setMarks(existing?.marks != null ? String(existing.marks) : "");
    setWeakness(existing?.weakness ?? "");
    setTeacherAction(existing?.teacherAction ?? "");
    setGuardianAction(existing?.guardianAction ?? "");
  }

  async function onSave(): Promise<void> {
    if (!openId) return;
    setError(null);
    setBusy(true);
    const res = await enter({
      testId,
      studentId: openId,
      status,
      marks: status === "PRESENT" && marks.trim() ? Number(marks) : null,
      weakness: weakness.trim() || null,
      teacherAction: teacherAction.trim() || null,
      guardianAction: guardianAction.trim() || null,
    });
    setBusy(false);
    if (res.error) {
      // Surface both inline (in the open form, next to Save) and as a toast — the
      // form can be scrolled far from a top-of-screen banner (UX-1 R-Feedback).
      const msg = friendlyError(res.error);
      setError(msg);
      toast.show(msg, "danger");
      return;
    }
    toast.show(STR.ctResultSaved, "ok");
    setOpenId(null);
    refetch({ requestPolicy: "network-only" });
  }

  if (testQ.fetching) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!test) {
    return (
      <Screen>
        <Notice message={STR.errGeneric} tone="danger" />
      </Screen>
    );
  }
  // A RETIRED exam is not "not printed yet" — say so, show why, and give the admin
  // the way back (owner ask 2026-08-03). Without this, retiring would be a one-way
  // door: the exam leaves every list, so nothing could reach it to restore it.
  if (test.status === "CANCELLED") {
    return (
      <Screen>
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          <Muted>
            {ctUnitLabel(test)} · {hwSubjectLabel(test.subject)}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <Badge text={STR.ctRetiredBadge} tone="muted" />
          </View>
          <Notice message={STR.ctRetiredNotice} tone="warn" />
          {/* D-#627: WHO / WHEN / WHY, so the admin deciding whether to restore is not
              guessing. `notes` is the fallback for rows retired before the reason had a
              field of its own (it used to overwrite the teacher's note). */}
          {test.cancelledByName || test.cancelledAt ? (
            <Muted>
              {STR.ctRetiredBy}: {test.cancelledByName ?? "—"}
              {test.cancelledAt ? ` · ${isoDateLabel(test.cancelledAt)}` : ""}
            </Muted>
          ) : null}
          {(test.cancelReason ?? test.notes) ? (
            <Muted>
              {STR.ctRetiredReasonLabel}: {test.cancelReason ?? test.notes}
            </Muted>
          ) : null}
          {isAdmin ? (
            <View style={{ marginTop: space(3) }}>
              <Button
                title={STR.ctRestoreExam}
                onPress={() => void onRestore()}
                loading={retireBusy}
                disabled={retireBusy}
              />
            </View>
          ) : null}
          {error ? <Notice message={error} tone="danger" /> : null}
        </Card>
      </Screen>
    );
  }
  if (test.status !== "PRINTED") {
    return (
      <Screen>
        <Notice message={STR.ctNotPrinted} tone="warn" />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{title}</Body>
          {/* Class FIRST: the title carries only subject + test number, so an admin
              looking at "English · Test # 1" had no way to tell which class it belongs
              to (owner ask 2026-08-02). */}
          <Muted>
            {ctUnitLabel(test)} · {hwSubjectLabel(test.subject)} · {STR.ctTotalMarks}{" "}
            {bnNum(test.totalMarks)} · {STR.ctPassMark} {bnNum(test.passMark)}
          </Muted>
          <View style={{ marginTop: space(2) }}>
            <Button
              // A teacher can only SUBMIT for approval on the next screen — labelling
              // their button "Publish results" promised something they cannot do
              // (owner ask 2026-08-03). Admins really do publish.
              title={isAdmin ? STR.ctPublishTitle : STR.ctSubmitShort}
              variant="secondary"
              onPress={() => nav.navigate("ClassTestPublish", { testId, title })}
            />
          </View>

          {/* Correct a mis-typed total / pass mark / date (owner ask 2026-08-03 — a
              32-mark paper had been recorded as 42, and there was no update path at all,
              only a script). Open to Principal/Office AND the exam's own teacher, so a
              teacher can fix their own typo. Once marks exist the server refuses the
              TOTAL (it is the denominator of every percentage) but still allows the PASS
              MARK while every result is DRAFT — see updateClassTestDetails. */}
          {canEditDetails ? (
            <View style={{ marginTop: space(3) }}>
              {editOpen ? (
                <>
                  <Field label={STR.ctTotalMarks} value={editTotal} onChangeText={setEditTotal} keyboardType="number-pad" />
                  <Field label={STR.ctPassMark} value={editPass} onChangeText={setEditPass} keyboardType="number-pad" />
                  {/* The server's refusal (marks already entered, results already
                      published, pass mark above the total) has to land HERE, beside the
                      Save button. The only other Notice on this screen sits in the
                      CANCELLED early-return branch, so before this the reason was set in
                      state and never rendered — Save just appeared to do nothing. */}
                  {error ? <Notice message={error} tone="danger" /> : null}
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <Button title={STR.save} onPress={() => void onSaveDetails()} loading={editBusy} disabled={editBusy} />
                    <Button title={STR.cancel} variant="ghost" onPress={() => setEditOpen(false)} disabled={editBusy} />
                  </View>
                </>
              ) : (
                <Button
                  title={STR.ctEditDetails}
                  variant="ghost"
                  onPress={() => {
                    setError(null); // don't reopen onto a stale refusal from a previous attempt
                    setEditTotal(String(test.totalMarks));
                    setEditPass(String(test.passMark));
                    setEditOpen(true);
                  }}
                />
              )}
            </View>
          ) : null}

          {/* Retire (Principal/Office). The domain's own "delete": the exam leaves every
              board and the Overdue counts, the record survives, and it can be restored.
              Refused server-side once any mark exists. */}
          {isAdmin ? (
            <View style={{ marginTop: space(3) }}>
              {retireOpen ? (
                <>
                  <Field label={STR.ctRetireReason} value={retireReason} onChangeText={setRetireReason} multiline />
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <Button
                      title={STR.ctRetireExam}
                      onPress={() => void onRetire()}
                      loading={retireBusy}
                      disabled={retireBusy || !retireReason.trim()}
                    />
                    <Button title={STR.cancel} variant="ghost" onPress={() => setRetireOpen(false)} disabled={retireBusy} />
                  </View>
                </>
              ) : (
                <Button title={STR.ctRetireExam} variant="ghost" onPress={() => setRetireOpen(true)} />
              )}
            </View>
          ) : null}
        </Card>

        {studentsQ.fetching ? (
          <Loader label={STR.loading} />
        ) : students.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoStudents}</Muted>
          </Card>
        ) : (
          students.map((s) => {
            const existing = byStudent.get(s.id);
            const isOpen = openId === s.id;
            return (
              <Card key={s.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{s.name}</Body>
                    {/* On a group exam the children come from several classes, so the
                        class·section is what tells two same-named children apart
                        (D-#507). Null — and absent — on a section exam. */}
                    <Muted>{s.sectionNameBn ? `${s.schoolId} · ${s.sectionNameBn}` : s.schoolId}</Muted>
                  </View>
                  {existing ? (
                    existing.status === "ABSENT" ? (
                      <Badge text={STR.ctAbsent} tone="muted" />
                    ) : (
                      <Badge
                        text={`${bnNum(existing.marks ?? 0)}/${bnNum(existing.totalMarks)} · ${existing.pass ? STR.ctPass : STR.ctFail}`}
                        tone={existing.pass ? "ok" : "danger"}
                      />
                    )
                  ) : null}
                </View>

                {isAdmin && !isOpen && existing && (existing.weakness || existing.teacherAction || existing.guardianAction) ? (
                  // Admin read-only view of the teacher's comments (owner ask 2026-07-21).
                  // Teacher entry behavior below is unchanged — this block is display-only.
                  <View style={{ marginTop: space(2) }}>
                    <Muted style={{ fontWeight: "700" }}>{STR.ctTeacherComments}</Muted>
                    {existing.weakness ? (
                      <Muted>{`${STR.ctWeakness}: ${existing.weakness}`}</Muted>
                    ) : null}
                    {existing.teacherAction ? (
                      <Muted>{`${STR.ctTeacherAction}: ${existing.teacherAction}`}</Muted>
                    ) : null}
                    {existing.guardianAction ? (
                      <Muted>{`${STR.ctGuardianAction}: ${existing.guardianAction}`}</Muted>
                    ) : null}
                  </View>
                ) : null}

                {existing?.publishedAt ? (
                  // Published results are locked (owner ruling) — unpublish first (via the
                  // Result-publish screen above) before editing. Keeps guardians from seeing
                  // a silent change with no re-notify.
                  <View style={{ marginTop: space(2) }}>
                    <Muted>{STR.ctPublishedLocked}</Muted>
                  </View>
                ) : existing?.submittedAt ? (
                  // CT-8: submitted for approval — recall (Result publish screen) to edit.
                  <View style={{ marginTop: space(2) }}>
                    <Muted>{STR.ctSubmittedLocked}</Muted>
                  </View>
                ) : !isOpen ? (
                  <View style={{ marginTop: space(2) }}>
                    <Button title={STR.ctMark} variant="secondary" onPress={() => openStudent(s.id)} />
                  </View>
                ) : (
                  <View style={{ marginTop: space(2) }}>
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <Chip label={STR.ctPresent} selected={status === "PRESENT"} onPress={() => setStatus("PRESENT")} />
                      <Chip label={STR.ctAbsent} selected={status === "ABSENT"} onPress={() => setStatus("ABSENT")} />
                    </View>
                    {status === "PRESENT" ? (
                      <Field label={`${STR.ctMarks} (0–${bnNum(test.totalMarks)})`} value={marks} onChangeText={setMarks} keyboardType="number-pad" />
                    ) : null}
                    <Field label={STR.ctWeakness} value={weakness} onChangeText={setWeakness} />
                    <Field label={STR.ctTeacherAction} value={teacherAction} onChangeText={setTeacherAction} helper={STR.ctTeacherActionHint} />
                    <Field label={STR.ctGuardianAction} value={guardianAction} onChangeText={setGuardianAction} />
                    {error ? <Notice message={error} tone="danger" /> : null}
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <Button title={STR.ctSaveResult} onPress={onSave} loading={busy} disabled={busy} />
                      <Button title={STR.cancel} variant="ghost" onPress={() => setOpenId(null)} />
                    </View>
                  </View>
                )}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
