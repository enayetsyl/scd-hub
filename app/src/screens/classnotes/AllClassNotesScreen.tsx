/**
 * AllClassNotesScreen (owner ask 2026-08-17) — the class-note ARCHIVE.
 *
 * `MyClassNotesScreen` answers "what do I owe today"; this screen answers "what
 * has been posted, ever". One printed-report table — date · subject · class ·
 * posted by · attachment · section · edit · delete — behind class / section /
 * subject / teacher / date filters, 50 rows a page (server-side skip+limit, so a
 * year of notes never lands in one payload).
 *
 * Scope is the SERVER's decision, not this screen's: `classNotesPage` gives
 * routine:manage the whole school and pins everyone else to their own notes
 * (`classNoteFilterOptions.canManage` says which happened). The row actions
 * follow the same line — a teacher edits the note they authored, deleting stays
 * routine:manage.
 *
 * The note's text is a COLUMN (owner ask, 2026-08-17), clamped to two lines with a
 * ▸/▾ caret; pressing anywhere on the row unclamps it and reveals its attachment
 * links, and "Expand all / Collapse all" does the whole page at once. Rows stay
 * one-line-tall by default so 50 of them are still scannable — the point of a
 * table — while a long note is one tap from being read in full.
 */
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  CLASS_NOTES_PAGE_QUERY,
  CLASS_NOTE_FILTER_OPTIONS_QUERY,
  UPDATE_CLASS_NOTE,
  DELETE_CLASS_NOTE,
  type ClassNoteAdminRowT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Field, Button, Badge, Loader, Notice, Select } from "../../components/ui";
import { ClassNoteAttachments, type AttachmentRef } from "../../components/ClassNoteAttachments";
import { DateField } from "../../components/DateField";
import { useAuth } from "../../auth/AuthContext";
import { openStoredFile } from "../../lib/files";
import { STR, bnNum, routineSubjectLabel, classLevelLabel, getActiveLang, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import { REPORT_PAPER as REPORT } from "../../theme/reportPaper";

const ALL = "";

/** The class cell: the English roster label where the UI is English, the Bangla
 *  class name otherwise; a subject-group note has no class, only its group name. */
function rowClass(r: ClassNoteAdminRowT): string {
  const lang = getActiveLang();
  if (lang === "en" && r.classLevel != null) return classLevelLabel(r.classLevel);
  return r.classNameBn ?? r.subjectGroupNameBn ?? "—";
}
function rowSection(r: ClassNoteAdminRowT): string {
  const lang = getActiveLang();
  return (lang === "en" ? r.sectionCode ?? r.sectionNameBn : r.sectionNameBn) ?? "—";
}

const COLUMNS = [
  { key: "date", labelKey: "cnColDate", width: 120 },
  { key: "subject", labelKey: "subject", width: 140 },
  { key: "class", labelKey: "cnColClass", width: 130 },
  // The note itself (owner ask, 2026-08-17): two lines in the row, the whole thing
  // one tap away. It sits beside the class/subject that identify it, not at the far
  // end past the columns nobody reads a note by.
  { key: "note", labelKey: "cnContent", width: 340 },
  { key: "teacher", labelKey: "cnPostedBy", width: 170 },
  { key: "attachment", labelKey: "cnAttachments", width: 110 },
  { key: "section", labelKey: "section", width: 120 },
  { key: "actions", labelKey: "cnColActions", width: 190 },
] as const;
const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);
/** Lines of the note a collapsed row shows before it has to be expanded. */
const COLLAPSED_LINES = 2;

function Cell({ width, children }: { width: number; children: React.ReactNode }): React.ReactElement {
  return <View style={{ width, padding: space(2), justifyContent: "center" }}>{children}</View>;
}

export default function AllClassNotesScreen(): React.ReactElement {
  const { user } = useAuth();
  const toast = useToast();
  const { confirmAction } = useConfirm();

  // Filters. Empty = unfiltered; the archive opens on "everything, newest first",
  // which is what the owner asked to see.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [classId, setClassId] = useState<string>(ALL);
  const [sectionId, setSectionId] = useState<string>(ALL);
  const [subject, setSubject] = useState<string>(ALL);
  const [teacherId, setTeacherId] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  const [optionsQ] = useQuery({ query: CLASS_NOTE_FILTER_OPTIONS_QUERY, requestPolicy: "cache-and-network" });
  const options = optionsQ.data?.classNoteFilterOptions;
  const canManage = options?.canManage ?? false;

  const variables = useMemo(
    () => ({
      from: from || null,
      to: to || null,
      classId: classId || null,
      sectionId: sectionId || null,
      subject: subject || null,
      teacherId: teacherId || null,
      page,
    }),
    [from, to, classId, sectionId, subject, teacherId, page],
  );
  const [q, refetch] = useQuery({ query: CLASS_NOTES_PAGE_QUERY, variables, requestPolicy: "cache-and-network" });
  const [, updateNote] = useMutation(UPDATE_CLASS_NOTE);
  const [, deleteNote] = useMutation(DELETE_CLASS_NOTE);

  const rows = q.data?.classNotesPage?.rows ?? [];
  const total = q.data?.classNotesPage?.total ?? 0;
  const pageSize = q.data?.classNotesPage?.pageSize ?? 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  // Expanded rows, by id — a SET rather than one id, because the owner asked to be
  // able to open the notes and shut them again, which only reads as "expand all /
  // collapse all" if more than one can be open at once.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string): void =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allExpanded = rows.length > 0 && rows.every((r) => expanded.has(r.id));
  const [editRow, setEditRow] = useState<ClassNoteAdminRowT | null>(null);
  const [editText, setEditText] = useState("");
  const [editFiles, setEditFiles] = useState<AttachmentRef[]>([]);
  const [busy, setBusy] = useState(false);

  /** Any filter change resets to page 1 — page 7 of the old result set means
   *  nothing in the new one, and an out-of-range page reads as "no notes". */
  function withReset<T>(set: (v: T) => void): (v: T) => void {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  const classOptions = useMemo(
    () => [{ label: STR.all, value: ALL }, ...(options?.classes ?? []).map((c) => ({ label: c.label, value: c.id }))],
    [options],
  );
  // Sections narrow to the chosen class, so the two selects can never describe an
  // impossible pair.
  const sectionOptions = useMemo(
    () => [
      { label: STR.all, value: ALL },
      ...(options?.sections ?? [])
        .filter((s) => !classId || s.parentId === classId)
        .map((s) => ({ label: s.label, value: s.id })),
    ],
    [options, classId],
  );
  const subjectOptions = useMemo(
    () => [
      { label: STR.all, value: ALL },
      ...(options?.subjects ?? []).map((s) => ({ label: routineSubjectLabel(s), value: s })),
    ],
    [options],
  );
  const teacherOptions = useMemo(
    () => [{ label: STR.all, value: ALL }, ...(options?.teachers ?? []).map((tt) => ({ label: tt.label, value: tt.id }))],
    [options],
  );

  function onClass(v: string): void {
    setClassId(v);
    setSectionId(ALL);
    setPage(1);
  }

  function onReset(): void {
    setFrom("");
    setTo("");
    setClassId(ALL);
    setSectionId(ALL);
    setSubject(ALL);
    setTeacherId(ALL);
    setPage(1);
  }

  function startEdit(r: ClassNoteAdminRowT): void {
    setEditRow(r);
    setEditText(r.taughtSummaryBn);
    setEditFiles(r.attachments.map((a) => ({ fileId: a.id, name: a.name })));
  }

  async function saveEdit(): Promise<void> {
    if (!editRow) return;
    setBusy(true);
    const res = await updateNote({
      id: editRow.id,
      taughtSummaryBn: editText.trim(),
      attachmentIds: editFiles.map((f) => f.fileId),
    });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.saved, "ok");
    setEditRow(null);
    refetch({ requestPolicy: "network-only" });
  }

  async function onDelete(r: ClassNoteAdminRowT): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    const res = await deleteNote({ id: r.id });
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.cnNoteDeleted, "ok");
    if (editRow?.id === r.id) setEditRow(null);
    refetch({ requestPolicy: "network-only" });
  }

  const mayEdit = (r: ClassNoteAdminRowT): boolean => canManage || (!!user?.id && r.authorId === user.id);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cnAllNotesTitle}</Body>
          <Muted>{STR.cnAllNotesHint}</Muted>
          {optionsQ.data && !canManage ? <Muted style={{ marginTop: space(1) }}>{STR.cnMyNotesOnly}</Muted> : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3) }}>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <DateField label={STR.rptFrom} value={from} onChange={withReset(setFrom)} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <DateField label={STR.rptTo} value={to} onChange={withReset(setTo)} />
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.cnColClass} value={classId} options={classOptions} onChange={onClass} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.section} value={sectionId} options={sectionOptions} onChange={withReset(setSectionId)} />
            </View>
            <View style={{ minWidth: 180, flexGrow: 1 }}>
              <Select label={STR.subject} value={subject} options={subjectOptions} onChange={withReset(setSubject)} />
            </View>
            {canManage ? (
              <View style={{ minWidth: 180, flexGrow: 1 }}>
                <Select label={STR.cnPostedBy} value={teacherId} options={teacherOptions} onChange={withReset(setTeacherId)} />
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) }}>
            <Badge
              text={`${STR.rtTableShowing} ${bnNum(firstRow)}–${bnNum(lastRow)} ${STR.rtTableOf} ${bnNum(total)}`}
              tone="muted"
            />
            {rows.length > 0 ? (
              <Button
                title={allExpanded ? `▴ ${STR.cnCollapseAll}` : `▾ ${STR.cnExpandAll}`}
                variant="secondary"
                onPress={() => setExpanded(allExpanded ? new Set() : new Set(rows.map((r) => r.id)))}
              />
            ) : null}
            <Button title={STR.rtTableReset} variant="ghost" onPress={onReset} />
          </View>
        </Card>

        {editRow ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.cnEditingNote}: {isoDateLabel(editRow.date)} · {routineSubjectLabel(editRow.subject)} · {rowClass(editRow)}
            </Body>
            <View style={{ marginTop: space(2), gap: space(1) }}>
              <Field label={STR.cnContent} value={editText} onChangeText={setEditText} multiline />
              <ClassNoteAttachments value={editFiles} onChange={setEditFiles} />
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Button title={STR.cancel} variant="ghost" onPress={() => setEditRow(null)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={busy ? STR.saving : STR.save} onPress={() => void saveEdit()} loading={busy} disabled={busy} />
                </View>
              </View>
            </View>
          </Card>
        ) : null}

        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.fetching && rows.length === 0 ? <Loader label={STR.loading} /> : null}
        {!q.fetching && rows.length === 0 ? <Notice message={STR.cnNoNotes} tone="ok" /> : null}

        {rows.length > 0 ? (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ minWidth: TABLE_WIDTH }}>
                <View style={{ flexDirection: "row", backgroundColor: REPORT.headerBg }}>
                  {COLUMNS.map((col) => (
                    <View
                      key={col.key}
                      style={{
                        width: col.width,
                        paddingVertical: space(2),
                        paddingHorizontal: space(2),
                        justifyContent: "center",
                        borderRightWidth: 1,
                        borderRightColor: REPORT.headerDivider,
                      }}
                    >
                      <Text style={{ color: REPORT.headerText, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {STR[col.labelKey]}
                      </Text>
                    </View>
                  ))}
                </View>

                {rows.map((r, index) => {
                  const isOpen = expanded.has(r.id);
                  return (
                    <View key={r.id}>
                      <Pressable
                        onPress={() => toggleRow(r.id)}
                        style={({ pressed }) => [
                          {
                            flexDirection: "row",
                            backgroundColor: index % 2 === 0 ? REPORT.rowEven : REPORT.rowOdd,
                            borderBottomWidth: 1,
                            borderBottomColor: REPORT.rowBorder,
                          },
                          pressed ? { backgroundColor: REPORT.rowPressed } : null,
                        ]}
                      >
                        <Cell width={COLUMNS[0].width}>
                          <Body style={{ fontWeight: "700", color: REPORT.text }}>{isoDateLabel(r.date)}</Body>
                        </Cell>
                        <Cell width={COLUMNS[1].width}>
                          <Body style={{ color: REPORT.text }}>{routineSubjectLabel(r.subject)}</Body>
                        </Cell>
                        <Cell width={COLUMNS[2].width}>
                          <Body style={{ color: REPORT.text }}>{rowClass(r)}</Body>
                        </Cell>
                        {/* The note, two lines deep, with the expand/shrink control
                            ON the text — the row is pressable anywhere, but a
                            caret is what tells the reader there is more. */}
                        <Cell width={COLUMNS[3].width}>
                          <View style={{ flexDirection: "row", gap: space(1), alignItems: "flex-start" }}>
                            <Text style={{ color: REPORT.textMuted, fontSize: 13, lineHeight: 20 }}>
                              {isOpen ? "▾" : "▸"}
                            </Text>
                            <Body
                              style={{ color: REPORT.text, flex: 1 }}
                              numberOfLines={isOpen ? undefined : COLLAPSED_LINES}
                            >
                              {r.taughtSummaryBn}
                            </Body>
                          </View>
                        </Cell>
                        <Cell width={COLUMNS[4].width}>
                          <Body style={{ color: REPORT.text }}>{r.authorName ?? "—"}</Body>
                        </Cell>
                        <Cell width={COLUMNS[5].width}>
                          <Muted style={{ color: REPORT.textMuted }}>
                            {r.attachments.length > 0 ? `📎 ${bnNum(r.attachments.length)}` : "—"}
                          </Muted>
                        </Cell>
                        <Cell width={COLUMNS[6].width}>
                          <Muted style={{ color: REPORT.textMuted }}>{rowSection(r)}</Muted>
                        </Cell>
                        <Cell width={COLUMNS[7].width}>
                          <View style={{ flexDirection: "row", gap: space(1) }}>
                            {mayEdit(r) ? (
                              <Button title={`✏️ ${STR.cnActionEdit}`} variant="secondary" onPress={() => startEdit(r)} />
                            ) : null}
                            {canManage ? (
                              <Button title={`🗑 ${STR.cnActionDelete}`} variant="danger" onPress={() => void onDelete(r)} />
                            ) : null}
                            {!mayEdit(r) && !canManage ? <Muted style={{ color: REPORT.textMuted }}>—</Muted> : null}
                          </View>
                        </Cell>
                      </Pressable>

                      {/* Expanding also surfaces the attachments, which the count
                          column can only tell you exist. The note text itself is
                          already unclamped in the row above. */}
                      {isOpen && r.attachments.length > 0 ? (
                        <View
                          style={{
                            width: TABLE_WIDTH,
                            padding: space(3),
                            backgroundColor: REPORT.rowOdd,
                            borderBottomWidth: 1,
                            borderBottomColor: REPORT.rowBorder,
                            gap: space(1),
                          }}
                        >
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                            {r.attachments.map((a) => (
                              <Button
                                key={a.id}
                                title={`📎 ${a.name}`}
                                variant="ghost"
                                onPress={() => void openStoredFile(a.id).catch(() => toast.show(STR.errGeneric, "danger"))}
                              />
                            ))}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </Card>
        ) : null}

        {total > pageSize ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(3) }}>
            <Button title={`‹ ${STR.cnPagePrev}`} variant="secondary" disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))} />
            <Muted>
              {STR.cnPage} {bnNum(page)} / {bnNum(pageCount)}
            </Muted>
            <Button
              title={`${STR.cnPageNext} ›`}
              variant="secondary"
              disabled={page >= pageCount}
              onPress={() => setPage((p) => Math.min(pageCount, p + 1))}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
