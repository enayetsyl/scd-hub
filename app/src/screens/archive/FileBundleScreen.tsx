/**
 * FileBundleScreen (AR-1, prd-script-archive §8) — record "N scripts of test X
 * filed in box Y". Reached from a class-test row's "ফাইল করা হয়নি" action
 * (testId in the route) or standalone: then the caller picks one of THEIR OWN
 * official (PRINTED) tests not yet filed. Boxes must be ACTIVE; the server
 * re-gates everything (teacher = own section only, Office = any).
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MY_CLASS_TESTS_QUERY } from "../../graphql/classTest";
import {
  STORAGE_BOXES_QUERY,
  ARCHIVE_LOCATIONS_QUERY,
  FILE_SCRIPT_BUNDLE,
} from "../../graphql/archive";
import { Screen, Card, Body, Muted, Button, Field, Select, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickAndUploadArchivePhoto, FileUploadError } from "../../lib/files";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;
type Route = RouteProp<ClassTestStackParamList, "ArchiveFileBundle">;

export default function FileBundleScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fixedTestId = route.params?.testId;

  const [testId, setTestId] = React.useState<string | null>(fixedTestId ?? null);
  const [scriptCount, setScriptCount] = React.useState("");
  const [boxId, setBoxId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [photoIds, setPhotoIds] = React.useState<string[]>([]);
  const [note, setNote] = React.useState<{ text: string; bad: boolean } | null>(null);

  const [myQ] = useQuery({ query: MY_CLASS_TESTS_QUERY, variables: {}, pause: !!fixedTestId });
  const printed = React.useMemo(
    () => (myQ.data?.myClassTests ?? []).filter((t) => t.status === "PRINTED"),
    [myQ.data],
  );
  const printedIds = React.useMemo(() => printed.map((t) => t.id), [printed]);
  const [locsQ] = useQuery({
    query: ARCHIVE_LOCATIONS_QUERY,
    variables: { testIds: printedIds },
    pause: !!fixedTestId || printedIds.length === 0,
  });
  const filedIds = React.useMemo(
    () => new Set((locsQ.data?.archiveLocationsForTests ?? []).map((l) => l.testId)),
    [locsQ.data],
  );
  const candidates = printed.filter((t) => !filedIds.has(t.id));

  const [boxesQ] = useQuery({ query: STORAGE_BOXES_QUERY, variables: { status: "ACTIVE" } });
  const boxes = boxesQ.data?.storageBoxes ?? [];

  const [fileRes, fileBundle] = useMutation(FILE_SCRIPT_BUNDLE);

  async function onAttachPhoto(): Promise<void> {
    setNote(null);
    try {
      const up = await pickAndUploadArchivePhoto();
      if (up) {
        setPhotoIds((ids) => [...ids, up.fileId]);
        setNote({ text: STR.arPhotoUploaded, bad: false });
      }
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), bad: true });
    }
  }

  async function onSubmit(): Promise<void> {
    setNote(null);
    const count = Number(scriptCount);
    if (!testId || !boxId || !Number.isInteger(count) || count < 1) return;
    const res = await fileBundle({
      sourceKind: "CLASS_TEST",
      refId: testId,
      scriptCount: count,
      boxId,
      notes: notes.trim() || null,
      attachmentFileIds: photoIds.length ? photoIds : null,
    });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    const bundleId = res.data?.fileScriptBundle.id;
    if (bundleId) {
      nav.replace("ArchiveBundle", { bundleId });
    } else {
      nav.goBack();
    }
  }

  const count = Number(scriptCount);
  const ready = !!testId && !!boxId && Number.isInteger(count) && count >= 1;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.arFileTitle}</Body>
          {fixedTestId ? (
            <Muted style={{ marginTop: space(1) }}>{route.params?.ctId ?? ""}</Muted>
          ) : (
            <>
              <Select
                label={STR.arPickTest}
                value={testId}
                searchable
                options={candidates.map((t) => ({
                  value: t.id,
                  label: `${t.ctId} · ${hwSubjectLabel(t.subject)} · ${STR.ctTestNumber} ${bnNum(t.testNumber)}`,
                  hint: isoDateLabel(t.examDate),
                }))}
                onChange={setTestId}
                placeholder={STR.arPickTest}
                emptyText={STR.arNoResults}
                helper={STR.arAlreadyFiledPickerNote}
              />
            </>
          )}
          <Field
            label={STR.arScriptCount}
            value={scriptCount}
            onChangeText={setScriptCount}
            keyboardType="number-pad"
          />
          <Select
            label={STR.arPickBox}
            value={boxId}
            options={boxes.map((b) => ({
              value: b.id,
              label: `${b.boxCode}${b.label ? ` · ${b.label}` : ""}`,
              hint: b.locationNote,
            }))}
            onChange={setBoxId}
            placeholder={STR.arPickBox}
            emptyText={STR.arNoBoxes}
          />
          <Field label={STR.arNotes} value={notes} onChangeText={setNotes} multiline />
          <View style={{ marginTop: space(2), gap: space(2) }}>
            <Button title={STR.arPhotoAttach} variant="secondary" onPress={() => void onAttachPhoto()} />
            {photoIds.length > 0 ? <Muted>{`${STR.arPhotoUploaded} (${bnNum(photoIds.length)})`}</Muted> : null}
            {note ? <Notice message={note.text} tone={note.bad ? "danger" : "ok"} /> : null}
            <Button
              title={STR.arFileBundle}
              disabled={!ready || fileRes.fetching}
              onPress={() => void onSubmit()}
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
