/**
 * ClassNotesAdminScreen (Principal/Office) — every class note for a date with all
 * info (class · section · subject · content · author · attachments) plus per-row
 * inline EDIT (updateClassNote — summary + attachments) and DELETE (deleteClassNote).
 * routine:manage; reachable from the Routine tab. Full-width card list.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  CLASS_NOTES_ADMIN_QUERY,
  UPDATE_CLASS_NOTE,
  DELETE_CLASS_NOTE,
  type ClassNoteAdminRowT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Field, Button, Badge, Loader, Notice } from "../../components/ui";
import { ClassNoteAttachments, type AttachmentRef } from "../../components/ClassNoteAttachments";
import { useReportRange, useRowFilters } from "../../components/ReportFilters";
import { openStoredFile } from "../../lib/files";
import { STR, routineSubjectLabel, classLevelLabel, getActiveLang, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

function rowClass(r: ClassNoteAdminRowT): string {
  const lang = getActiveLang();
  if (lang === "en" && r.classLevel != null) return classLevelLabel(r.classLevel);
  return r.classNameBn ?? r.subjectGroupNameBn ?? "—";
}
function rowSection(r: ClassNoteAdminRowT): string | null {
  const lang = getActiveLang();
  return lang === "en" ? r.sectionCode ?? r.sectionNameBn : r.sectionNameBn;
}

export default function ClassNotesAdminScreen(): React.ReactElement {
  // Owner request: class / subject / teacher / date-range filters. Range fetches
  // server-side (dateTo); the row filters are the D-#309 client-side pattern —
  // options derive from the fetched rows, so a select never offers 0 matches.
  const { fromKey, toKey, node: rangeNode } = useReportRange(1);
  const [q, refetch] = useQuery({
    query: CLASS_NOTES_ADMIN_QUERY,
    variables: { date: fromKey, dateTo: toKey },
    requestPolicy: "cache-and-network",
  });
  const [, updateNote] = useMutation(UPDATE_CLASS_NOTE);
  const [, deleteNote] = useMutation(DELETE_CLASS_NOTE);
  const { confirmAction } = useConfirm();
  const toast = useToast();

  const allRows = q.data?.classNotesAdmin ?? [];
  const { filtered: rows, node: filterNode } = useRowFilters(allRows, {
    classOf: (r) => r.classLevel,
    teacherOf: (r) => r.authorName,
    subjectOf: (r) => r.subject,
    subjectLabel: routineSubjectLabel,
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editFiles, setEditFiles] = useState<AttachmentRef[]>([]);
  const [busy, setBusy] = useState(false);

  function startEdit(r: ClassNoteAdminRowT): void {
    setEditId(r.id);
    setEditText(r.taughtSummaryBn);
    setEditFiles(r.attachments.map((a) => ({ fileId: a.id, name: a.name })));
  }

  async function saveEdit(): Promise<void> {
    if (!editId) return;
    setBusy(true);
    const res = await updateNote({ id: editId, taughtSummaryBn: editText.trim(), attachmentIds: editFiles.map((f) => f.fileId) });
    setBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.saved, "ok");
    setEditId(null);
    refetch({ requestPolicy: "network-only" });
  }

  async function onDelete(id: string): Promise<void> {
    if (!(await confirmAction({ confirmLabel: STR.remove }))) return;
    const res = await deleteNote({ id });
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cnClassNotesAdmin}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            {rangeNode}
            {filterNode}
          </View>
          <View style={{ marginTop: space(2), alignSelf: "flex-start" }}>
            <Badge text={`${STR.rtTableShowing} ${rows.length}`} tone="muted" />
          </View>
        </Card>

        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.fetching && rows.length === 0 ? <Loader label={STR.loading} /> : null}
        {!q.fetching && rows.length === 0 ? <Notice message={STR.cnNoNotes} tone="ok" /> : null}

        {rows.map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
              <View style={{ flexShrink: 1 }}>
                <Body style={{ fontWeight: "700" }}>
                  {rowClass(r)}
                  {rowSection(r) ? ` · ${rowSection(r)}` : ""} · {routineSubjectLabel(r.subject)}
                </Body>
                <Muted>
                  {STR.cnAuthor}: {r.authorName ?? "—"} · {isoDateTimeLabel(r.publishedAt)}
                </Muted>
              </View>
            </View>

            {editId === r.id ? (
              <View style={{ marginTop: space(2), gap: space(1) }}>
                <Field label={STR.cnContent} value={editText} onChangeText={setEditText} multiline />
                <ClassNoteAttachments value={editFiles} onChange={setEditFiles} />
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Button title={STR.cancel} variant="ghost" onPress={() => setEditId(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title={busy ? STR.saving : STR.save} onPress={() => void saveEdit()} loading={busy} disabled={busy} />
                  </View>
                </View>
              </View>
            ) : (
              <>
                <Body style={{ marginTop: space(1) }}>{r.taughtSummaryBn}</Body>
                {r.attachments.length > 0 ? (
                  <View style={{ marginTop: space(1), flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    {r.attachments.map((a) => (
                      <Button
                        key={a.id}
                        title={`📎 ${a.name}`}
                        variant="ghost"
                        onPress={() => void openStoredFile(a.id).catch(() => toast.show(STR.errGeneric, "danger"))}
                      />
                    ))}
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                  <Button title={STR.cnEditNote} variant="secondary" onPress={() => startEdit(r)} />
                  <Button title={STR.remove} variant="danger" onPress={() => void onDelete(r.id)} />
                </View>
              </>
            )}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
