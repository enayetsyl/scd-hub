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
import { DateField } from "../../components/DateField";
import { openStoredFile } from "../../lib/files";
import { STR, routineSubjectLabel, classLevelLabel, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

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
  const [date, setDate] = useState(todayISO());
  const [q, refetch] = useQuery({ query: CLASS_NOTES_ADMIN_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const [, updateNote] = useMutation(UPDATE_CLASS_NOTE);
  const [, deleteNote] = useMutation(DELETE_CLASS_NOTE);
  const { confirmAction } = useConfirm();
  const toast = useToast();

  const rows = q.data?.classNotesAdmin ?? [];
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
          <DateField label={STR.attDate} value={date} onChange={setDate} />
          <Badge text={`${STR.rtTableShowing} ${rows.length}`} tone="muted" />
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
                  {STR.cnAuthor}: {r.authorName ?? "—"} · {new Date(r.publishedAt).toLocaleString()}
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
