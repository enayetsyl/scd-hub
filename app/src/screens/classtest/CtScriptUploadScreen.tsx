/**
 * CtScriptUploadScreen (CS-2/CS-3, docs/prd-ct-scripts.md §7.3, D-#716/#719) — the
 * Office's scan & tag screen for ONE class test's scripts.
 *
 *  1. Upload the scans (several at once; sorted by file name so a scanner's
 *     scan_0001, scan_0002 … stay in roll order). They sit in "ট্যাগ করা হয়নি".
 *  2. "রোল অনুযায়ী মিলিয়ে দিন" gives them, in order, to the PRESENT students who
 *     have no pages yet; a row's own "পৃষ্ঠা যোগ" adds pages to just that student.
 *  3. A present student whose paper never came is marked "খাতা নেই". Absentees
 *     need nothing.
 *  4. Publish (UPLOAD_DONE only) → guardians are notified. Then "শিক্ষককে খাতা দিন"
 *     when the paper goes back to the teacher to return in class.
 *
 * The subject is the TEST's own — nothing to pick. Every action is server-gated
 * (`roster:manage`) and the stage shown is always the server's.
 */
import React from "react";
import { ScrollView, View, Pressable, Text } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import {
  CT_SCRIPT_SHEET_QUERY,
  RECEIVE_CT_SCRIPTS,
  UNDO_RECEIVE_CT_SCRIPTS,
  WAIVE_CT_SCRIPTS,
  UNWAIVE_CT_SCRIPTS,
  ATTACH_CT_SCRIPT_PAGES,
  REMOVE_CT_SCRIPT_PAGE,
  SET_CT_SCRIPT_MISSING,
  PUBLISH_CT_SCRIPTS,
  UNPUBLISH_CT_SCRIPTS,
  HAND_BACK_CT_SCRIPTS,
  MARK_CT_SCRIPTS_RETURNED,
  type CtScriptStudentT,
} from "../../graphql/ctScripts";
import { Screen, Card, Body, Muted, Button, Badge, Field, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, isoDateLabel, ctScriptStageLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import {
  pickAndUploadCtScripts,
  openStoredFile,
  FileUploadError,
  FILE_VIEW_SUPPORTED,
  type UploadedFile,
} from "../../lib/files";
import { ctScriptStageTone, ctScriptRowTitle } from "../../lib/ctScriptStage";
import { makeStyles, radius, space, typeScale, useColors } from "../../theme";
import type { ClassTestStackParamList } from "../../navigation/types";

type Route = RouteProp<ClassTestStackParamList, "CtScriptUpload">;

const TAGGABLE = ["UPLOAD_PENDING", "UPLOAD_IN_PROGRESS", "UPLOAD_DONE"];

export default function CtScriptUploadScreen(): React.ReactElement {
  const route = useRoute<Route>();
  const { testId } = route.params;
  const styles = useStyles();
  const colors = useColors();

  const [sheetQ, refetchSheet] = useQuery({ query: CT_SCRIPT_SHEET_QUERY, variables: { testId } });
  const sheet = sheetQ.data?.classTestScriptSheet ?? null;
  const t = sheet?.test ?? null;
  const stage = t?.stage ?? null;
  const taggable = !!stage && TAGGABLE.includes(stage);

  const [note, setNote] = React.useState<{ text: string; tone: "ok" | "danger" } | null>(null);
  const [tray, setTray] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [count, setCount] = React.useState<number | null>(null);
  const [waiveOpen, setWaiveOpen] = React.useState(false);
  const [reason, setReason] = React.useState<string>(STR.csWaiveDefault);

  const [, receive] = useMutation(RECEIVE_CT_SCRIPTS);
  const [, undoReceive] = useMutation(UNDO_RECEIVE_CT_SCRIPTS);
  const [, waive] = useMutation(WAIVE_CT_SCRIPTS);
  const [, unwaive] = useMutation(UNWAIVE_CT_SCRIPTS);
  const [, attach] = useMutation(ATTACH_CT_SCRIPT_PAGES);
  const [, removePage] = useMutation(REMOVE_CT_SCRIPT_PAGE);
  const [, setMissing] = useMutation(SET_CT_SCRIPT_MISSING);
  const [, publish] = useMutation(PUBLISH_CT_SCRIPTS);
  const [, unpublish] = useMutation(UNPUBLISH_CT_SCRIPTS);
  const [, handBack] = useMutation(HAND_BACK_CT_SCRIPTS);
  const [, markReturned] = useMutation(MARK_CT_SCRIPTS_RETURNED);

  const refetch = (): void => refetchSheet({ requestPolicy: "network-only" });

  /** Run one mutation; show the server's Bangla refusal; refetch on success. */
  async function run(p: Promise<{ error?: unknown; data?: unknown }>, ok?: string): Promise<boolean> {
    setNote(null);
    setBusy(true);
    try {
      const res = await p;
      if (res.error) {
        setNote({ text: friendlyError(res.error as Parameters<typeof friendlyError>[0]), tone: "danger" });
        return false;
      }
      if (ok) setNote({ text: ok, tone: "ok" });
      refetch();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function pickToTray(): Promise<void> {
    setNote(null);
    setBusy(true);
    try {
      const out = await pickAndUploadCtScripts();
      if (out.uploaded.length) setTray((cur) => [...cur, ...out.uploaded]);
      if (out.failures.length) setNote({ text: `${STR.csUploadFailed}: ${out.failures.join("; ")}`, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  /** Pick files for ONE student and attach them straight away. */
  async function addPagesFor(s: CtScriptStudentT): Promise<void> {
    setNote(null);
    setBusy(true);
    let uploaded: UploadedFile[] = [];
    try {
      const out = await pickAndUploadCtScripts();
      uploaded = out.uploaded;
      if (out.failures.length) setNote({ text: `${STR.csUploadFailed}: ${out.failures.join("; ")}`, tone: "danger" });
    } finally {
      setBusy(false);
    }
    if (uploaded.length === 0) return;
    await run(attach({ testId, studentId: s.studentId, fileIds: uploaded.map((u) => u.fileId) }));
  }

  /** Tray files → unresolved PRESENT students, in roll order (the sheet is roll-sorted). */
  async function autoMatch(): Promise<void> {
    if (!sheet) return;
    const queue = [...tray];
    const targets = sheet.students.filter((s) => s.status === "PRESENT" && !s.missing && s.pages.length === 0);
    const used: string[] = [];
    setNote(null);
    setBusy(true);
    try {
      for (const s of targets) {
        const f = queue.shift();
        if (!f) break;
        const res = await attach({ testId, studentId: s.studentId, fileIds: [f.fileId] });
        if (res.error) {
          setNote({ text: friendlyError(res.error), tone: "danger" });
          break;
        }
        used.push(f.fileId);
      }
    } finally {
      setTray((cur) => cur.filter((f) => !used.includes(f.fileId)));
      setBusy(false);
      refetch();
    }
  }

  async function open(fileId: string): Promise<void> {
    try {
      await openStoredFile(fileId);
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), tone: "danger" });
    }
  }

  const present = sheet?.students.filter((s) => s.status === "PRESENT") ?? [];
  const resolved = present.filter((s) => s.missing || s.pages.length > 0).length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <QueryGate result={sheetQ} onRetry={refetch} loaderLabel={STR.loading}>
          {!sheet || !t ? (
            <Muted>{STR.csNotInFlow}</Muted>
          ) : (
            <>
              <Card>
                <View style={styles.headRow}>
                  <Body style={{ fontWeight: "700", flex: 1 }}>{ctScriptRowTitle(t, STR.ctTestNumber, bnNum)}</Body>
                  <Badge text={ctScriptStageLabel(t.stage)} tone={ctScriptStageTone(t.stage)} />
                </View>
                <Muted>
                  {t.ctId} · {isoDateLabel(t.examDate)} · {t.teacherName}
                </Muted>
                {t.receivedAt ? (
                  <Muted>
                    {STR.csReceivedOn}: {bnNum(t.receivedCount ?? 0)} · {isoDateLabel(t.receivedAt)}
                  </Muted>
                ) : (
                  <Muted>
                    {STR.csDueBy}: {isoDateLabel(t.dueDateKey)}
                  </Muted>
                )}
                {t.waiveReason ? <Muted>{t.waiveReason}</Muted> : null}
              </Card>

              {note ? <Notice message={note.text} tone={note.tone} /> : null}

              {/* --- Not received yet: receive / skip ----------------------- */}
              {stage === "DUE" || stage === "OVERDUE" ? (
                <Card>
                  <Body>{STR.csHowMany}</Body>
                  <View style={styles.stepper}>
                    <Button
                      title="−"
                      variant="secondary"
                      onPress={() => setCount((c) => Math.max(0, (c ?? present.length) - 1))}
                    />
                    <Body style={styles.count}>{bnNum(count ?? present.length)}</Body>
                    <Button title="+" variant="secondary" onPress={() => setCount((c) => (c ?? present.length) + 1)} />
                    <Muted>/ {bnNum(present.length)}</Muted>
                  </View>
                  {(count ?? present.length) < present.length ? <Muted>{STR.csShortHint}</Muted> : null}
                  <Button
                    title={STR.csReceive}
                    loading={busy}
                    onPress={() => void run(receive({ testId, count: count ?? present.length }))}
                  />
                </Card>
              ) : null}

              {/* --- Scan & tag ----------------------------------------------- */}
              {taggable ? (
                <Card>
                  <Body style={{ fontWeight: "700" }}>{STR.csUploadTitle}</Body>
                  <Muted>{STR.csDropHint}</Muted>
                  <View style={styles.actions}>
                    <Button title={STR.csPickFiles} loading={busy} onPress={() => void pickToTray()} />
                    {stage === "UPLOAD_PENDING" ? (
                      <Button
                        title={STR.csUndoReceive}
                        variant="ghost"
                        disabled={busy}
                        onPress={() => void run(undoReceive({ testId }))}
                      />
                    ) : null}
                  </View>
                  {tray.length > 0 ? (
                    <View style={{ marginTop: space(3), gap: space(2) }}>
                      <Body>
                        {STR.csUntagged}: {bnNum(tray.length)}
                      </Body>
                      <Muted>{tray.map((f) => f.originalName).join(", ")}</Muted>
                      <Button title={STR.csAutoMatch} variant="secondary" loading={busy} onPress={() => void autoMatch()} />
                      <Muted>{STR.csAutoMatchHint}</Muted>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              {/* --- The roster ------------------------------------------------ */}
              <Card>
                <View style={styles.headRow}>
                  <Body style={{ fontWeight: "700" }}>{STR.csColumn}</Body>
                  <Muted>
                    {bnNum(resolved)}/{bnNum(present.length)} {STR.csResolved}
                  </Muted>
                </View>
                {sheet.students.map((s) => {
                  const absent = s.status !== "PRESENT";
                  return (
                    <View key={s.studentId} style={[styles.row, absent && { opacity: 0.6 }]}>
                      <Text style={styles.roll}>{s.rollNumber ? bnNum(s.rollNumber) : "—"}</Text>
                      <View style={{ flex: 1, minWidth: 0, gap: space(1) }}>
                        <Body numberOfLines={1}>{s.nameBn || s.name}</Body>
                        <View style={styles.pages}>
                          {s.pages.map((p, i) => (
                            <View key={p.fileId} style={[styles.page, { borderColor: colors.border }]}>
                              <Pressable
                                onPress={() => (FILE_VIEW_SUPPORTED ? void open(p.fileId) : undefined)}
                                accessibilityLabel={`${STR.csPage} ${i + 1}`}
                              >
                                <Text style={styles.pageText}>
                                  {STR.csPage} {bnNum(i + 1)}
                                </Text>
                              </Pressable>
                              {taggable ? (
                                <Pressable
                                  hitSlop={8}
                                  accessibilityLabel={STR.csRemovePage}
                                  onPress={() => void run(removePage({ testId, studentId: s.studentId, fileId: p.fileId }))}
                                >
                                  <Text style={[styles.pageText, { color: colors.error }]}>✕</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          ))}
                          {absent ? (
                            <Badge text={STR.csAbsentNoScript} tone="muted" />
                          ) : s.missing ? (
                            <Badge text={STR.csMissing} tone="muted" />
                          ) : s.pages.length === 0 ? (
                            <Badge text={STR.csPending} tone="warn" />
                          ) : null}
                        </View>
                      </View>
                      {taggable && !absent ? (
                        <View style={styles.rowActions}>
                          {!s.missing ? (
                            <Button
                              title={STR.csAddPage}
                              variant="secondary"
                              disabled={busy}
                              onPress={() => void addPagesFor(s)}
                            />
                          ) : null}
                          {s.pages.length === 0 ? (
                            <Button
                              title={s.missing ? STR.csHasScript : STR.csMissing}
                              variant="ghost"
                              disabled={busy}
                              onPress={() =>
                                void run(setMissing({ testId, studentId: s.studentId, missing: !s.missing }))
                              }
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>

              {/* --- Publish / hand back / return ------------------------------- */}
              {taggable ? (
                <Card>
                  <Muted>{STR.csPublishHint}</Muted>
                  <Button
                    title={STR.csPublish}
                    disabled={stage !== "UPLOAD_DONE" || busy}
                    onPress={() =>
                      void (async () => {
                        setNote(null);
                        setBusy(true);
                        try {
                          const res = await publish({ testId });
                          if (res.error) {
                            setNote({ text: friendlyError(res.error), tone: "danger" });
                            return;
                          }
                          const n = res.data?.publishClassTestScripts.notifiedGuardianCount ?? 0;
                          setNote({ text: `${bnNum(n)} ${STR.csPublishedNote}`, tone: "ok" });
                          refetch();
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  />
                </Card>
              ) : null}

              {stage === "PUBLISHED" ? (
                <Card>
                  <View style={styles.actions}>
                    <Button title={STR.csHandBack} loading={busy} onPress={() => void run(handBack({ testId }))} />
                    <Button
                      title={STR.csUnpublish}
                      variant="ghost"
                      disabled={busy}
                      onPress={() => void run(unpublish({ testId }))}
                    />
                  </View>
                </Card>
              ) : null}

              {stage === "WITH_TEACHER" || stage === "RETURN_OVERDUE" ? (
                <Card>
                  <Muted>
                    {STR.csReturnTitle} · {STR.csDueBy}: {isoDateLabel(t.returnDueDateKey)} · {t.teacherName}
                  </Muted>
                  <Button
                    title={STR.csReturnDone}
                    variant="secondary"
                    loading={busy}
                    onPress={() => void run(markReturned({ testId }))}
                  />
                </Card>
              ) : null}

              {/* --- Skip (before publish) / restore ---------------------------- */}
              {stage === "WAIVED" ? (
                <Button title={STR.csUnwaive} variant="ghost" disabled={busy} onPress={() => void run(unwaive({ testId }))} />
              ) : stage && ["DUE", "OVERDUE", ...TAGGABLE].includes(stage) ? (
                waiveOpen ? (
                  <Card>
                    <Field label={STR.csWaiveReason} value={reason} onChangeText={setReason} />
                    <View style={styles.actions}>
                      <Button
                        title={STR.csWaive}
                        variant="danger"
                        disabled={busy || !reason.trim()}
                        onPress={() =>
                          void run(waive({ testId, reason })).then((ok) => {
                            if (ok) setWaiveOpen(false);
                          })
                        }
                      />
                      <Button title={STR.csCancel} variant="ghost" onPress={() => setWaiveOpen(false)} />
                    </View>
                  </Card>
                ) : (
                  <Button title={STR.csWaive} variant="ghost" onPress={() => setWaiveOpen(true)} />
                )
              ) : null}
            </>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  stepper: { flexDirection: "row", alignItems: "center", gap: space(3), marginVertical: space(2) },
  count: { ...typeScale.sectionTitle, minWidth: 40, textAlign: "center", color: c.textPrimary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(3),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  roll: { ...typeScale.bodyStrong, color: c.textPrimary, width: 32 },
  pages: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) },
  page: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    backgroundColor: c.surface,
  },
  pageText: { ...typeScale.caption, color: c.textPrimary },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
}));
