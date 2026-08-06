/**
 * NewPrintRequestScreen (PQ-3, D-#281) — a teacher sends a document to the Office.
 *
 * Four sources, exactly one per request (the server enforces the XOR):
 *   UPLOAD           — pick up to 5 jpeg/png/pdf files (POST /files/print)
 *   LINK             — a Google Form / Doc URL
 *   SET              — an assembled question set, passed in via route params from
 *                      Set detail's "Send to print"
 *   CONTENT_ARTIFACT — a chapter/session plan, passed in from the plan viewer
 *
 * No PDF snapshot is taken: an assembled set is locked, so its id is enough.
 *
 * PQ-7: the request also names the CLASS and SUBJECT it is for. Without them every
 * teacher-filed job landed in the reprint history as "no class, no subject", which left
 * that screen's class axis usable only for class tests and hid Nursery/KG completely.
 *
 * D-#463: purpose/class/subject must now be ANSWERED — but "no class" and "not
 * subject-specific" are themselves answers, because 23% of this school's prints (office
 * notices, lesson plans) genuinely belong to none, and forcing a real class onto those
 * would store a confidently WRONG value where a blank at least reads as "unknown". The
 * one exception is ASSIGNMENT, which feeds the print-gap report (D-#459) and therefore
 * needs a real class+section+subject; the "none" chips are hidden for it.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  PRINT_PURPOSES,
  PRINT_PURPOSE_LABELS_EN,
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
  MAX_PRINT_UPLOADS,
  ROUTINE_SUBJECTS,
} from "@scd/shared";
import { CREATE_PRINT_REQUEST } from "../../graphql/printing";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import type { PrintStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Field, Chip, ChipRow, Button, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, classLevelLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import {
  pickAndUploadPrintFiles,
  uploadPrintWebFiles,
  FileUploadError,
  type MultiUploadResult,
} from "../../lib/files";
import { UploadDropZone } from "../../components/UploadDropZone";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<PrintStackParamList, "NewPrintRequest">;

/** D-#463: "deliberately none" for class/subject — distinct from `null`, which means the
 *  teacher has not answered yet. Both persist as null; the difference is only that one is
 *  a choice the form made them make, which is what stops the silent skip. */
const NONE = "__none__";
/** ASSIGNMENT feeds the print-gap report (D-#459), which matches on a REAL
 *  class+section+subject — "none" is not an available answer there. */
const ASSIGNMENT_NEEDS_REAL_TAGS = "ASSIGNMENT";

interface Attached {
  fileId: string;
  originalName: string;
}

export default function NewPrintRequestScreen({ route, navigation }: Props): React.ReactElement {
  const preset = route.params ?? {};
  const toast = useToast();

  // A set / plan arrives pre-selected from its own screen; otherwise the teacher picks.
  const presetSource = preset.setId ? "SET" : preset.contentArtifactId ? "CONTENT_ARTIFACT" : null;

  const { user } = useAuth();
  // The title ALWAYS carries the requesting teacher's name — including when a set or plan
  // supplies its own title, which previously dropped the name entirely (live-testing find).
  // Still editable.
  const [title, setTitle] = useState(() => {
    const who = user?.name;
    if (preset.title && who) return `${preset.title} — ${who}`;
    if (preset.title) return preset.title;
    return who ? `${STR.prTitleFor} ${who}` : "";
  });
  // D-#463: NO default. "Classwork" was pre-selected, so it was never blank but often
  // never actually chosen — which quietly inflated it in every purpose-based report.
  const [purpose, setPurpose] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sourceType, setSourceType] = useState<string>(presetSource ?? "UPLOAD");
  const [files, setFiles] = useState<Attached[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [copies, setCopies] = useState("1");
  // D-#294: FIXED = type the number; CLASS_PRESENT = one per student present in the
  // chosen class on the USE day (resolved from that day's attendance by the Office).
  const [copiesMode, setCopiesMode] = useState<"FIXED" | "CLASS_PRESENT">("FIXED");
  const [copiesClassId, setCopiesClassId] = useState<string | null>(null);
  // PQ-7 / D-#463 — what the print is FOR. An answer is now REQUIRED, but "no class" is
  // one of the legitimate answers: 23% of the school's prints (office notices, lesson
  // plans) genuinely belong to none, and forcing a real class onto those would store a
  // confidently WRONG value where a blank at least reads as "unknown". So: `null` = not
  // answered yet (blocks submit), NONE = deliberately none, else a real class id.
  const [classId, setClassId] = useState<string | null>(null);
  // D-#459: which section within the class — required for ASSIGNMENT so the print-gap
  // report can match a rotation cell to a specific section, not just a class.
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [neededByKey, setNeededByKey] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, create] = useMutation(CREATE_PRINT_REQUEST);

  // The class chips (N, K, 1…5) for CLASS_PRESENT mode — current academic year.
  const { selection } = useSectionContext();
  const [{ data: yearsData }] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const academicYearId =
    selection.academicYearId ?? yearsData?.academicYears.find((y) => y.current)?.id ?? null;
  const [{ data: classData }] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: academicYearId ?? "" },
    pause: !academicYearId,
  });
  // Nursery (-1) and KG (0) sort ahead of class 1..5 — the order the school reads them in.
  const classes = (classData?.classes ?? []).filter((c) => c.active).slice().sort((a, b) => a.level - b.level);
  const selectedClass = classes.find((c) => c.id === classId) ?? null;
  const activeSections = selectedClass ? selectedClass.sections.filter((s) => s.active) : [];
  // A class with exactly one section → auto-select it, same UX as ClassSectionSelect
  // (components/vocabPickers.tsx) uses elsewhere — no point making the user pick from one.
  const soleSection = activeSections.length === 1 ? activeSections[0] : null;
  React.useEffect(() => {
    if (soleSection && sectionId !== soleSection.id) setSectionId(soleSection.id);
  }, [soleSection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Shared upload tail for both entry points — the pick button and the web drop. */
  async function runUpload(upload: () => Promise<MultiUploadResult>): Promise<void> {
    if (files.length >= MAX_PRINT_UPLOADS) {
      setError(`${MAX_PRINT_UPLOADS} ${STR.prMaxFiles}`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      // D-#294 follow-up: pick SEVERAL files in one go (capped at the remaining
      // slots); partial failures keep the successful uploads and are reported.
      const { uploaded, failures } = await upload();
      if (uploaded.length > 0) {
        setFiles((prev) => [
          ...prev,
          ...uploaded.map((u) => ({ fileId: u.fileId, originalName: u.originalName })),
        ]);
      }
      if (failures.length > 0) setError(failures.join(" · "));
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function onPickFile(): Promise<void> {
    await runUpload(() => pickAndUploadPrintFiles(MAX_PRINT_UPLOADS - files.length));
  }

  /** Web only: files dragged onto the pick button, same cap + failure handling. */
  async function onDropFiles(dropped: File[]): Promise<void> {
    await runUpload(() => uploadPrintWebFiles(dropped, MAX_PRINT_UPLOADS - files.length));
  }

  /** Drop an attached file before submitting (it stays uploaded but is not bound). */
  function removeFile(fileId: string): void {
    setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  }

  /** Surface a validation failure BOTH inline and as a toast — the form scrolls, so a
   *  banner pinned to the top is invisible when you press Send at the bottom. */
  function fail(msg: string): void {
    setError(msg);
    toast.show(msg, "danger");
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    const n = Number(copies);
    if (!title.trim()) return fail(STR.prDocTitle);
    // D-#463: purpose/class/subject must be ANSWERED. "No class" and "not subject-specific"
    // are answers; skipping is not. This lives client-side by necessity — once "none" is
    // sent as null the server cannot tell a deliberate none from an omission.
    if (!purpose) return fail(STR.prNeedPurpose);
    if (!classId) return fail(STR.prNeedClassAnswer);
    if (!subject) return fail(STR.prNeedSubjectAnswer);
    if (!colour) return fail(STR.prNeedColour);
    if (!sides) return fail(STR.prNeedSides);
    if (copiesMode === "FIXED" && (!Number.isInteger(n) || n < 1)) return fail(STR.prCopies);
    if (copiesMode === "CLASS_PRESENT" && !copiesClassId) return fail(STR.prPickClass);
    if (!neededByKey) return fail(STR.prNeedNeededBy);
    if (sourceType === "UPLOAD" && files.length === 0) return fail(STR.prPickFile);
    if (sourceType === "LINK" && !linkUrl.trim()) return fail(STR.prLinkUrl);
    // D-#459: the print-gap report needs a REAL class+section+subject on an ASSIGNMENT —
    // "none" is not an available answer there, so the sentinels are rejected too.
    if (
      purpose === ASSIGNMENT_NEEDS_REAL_TAGS &&
      (classId === NONE || subject === NONE || !sectionId)
    ) {
      return fail(STR.prAssignmentNeedsTagging);
    }

    // "Deliberately none" persists as null — the same value a skip used to leave. The
    // difference the form buys is that it is now a decision, not an omission.
    const classIdOut = classId === NONE ? null : classId;
    const subjectOut = subject === NONE ? null : subject;

    setBusy(true);
    const res = await create({
      title: title.trim(),
      purpose,
      sourceType,
      setId: sourceType === "SET" ? preset.setId ?? null : null,
      contentArtifactId: sourceType === "CONTENT_ARTIFACT" ? preset.contentArtifactId ?? null : null,
      fileIds: sourceType === "UPLOAD" ? files.map((f) => f.fileId) : null,
      linkUrl: sourceType === "LINK" ? linkUrl.trim() : null,
      colour,
      sides,
      copies: copiesMode === "FIXED" ? n : 1, // finalized from attendance at print time
      copiesMode,
      // The count's class defaults to the job's own class — they are the same in practice.
      copiesClassId: copiesMode === "CLASS_PRESENT" ? copiesClassId ?? classIdOut : null,
      neededByKey,
      // PQ-7: carried so the reprint history can group and filter by them.
      classId: classIdOut,
      sectionId,
      subject: subjectOut,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (res.error || !res.data?.createPrintRequest) {
      fail(friendlyError(res.error));
      return;
    }
    toast.show(STR.prCreated, "ok");
    navigation.goBack();
  }

  /** A pre-selected set/plan is fixed — don't let the teacher switch it away. */
  const sourceLocked = presetSource !== null;

  return (
    <Screen scroll>
      <H2>{STR.prNew}</H2>
      {error ? <Notice message={error} tone="danger" /> : null}

      <Field label={STR.prDocTitle} value={title} onChangeText={setTitle} />

      {/* D-#463: nothing pre-selected — the teacher picks the purpose deliberately. */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prPurpose} *</Body>
        <ChipRow>
          {PRINT_PURPOSES.map((p) => (
            <Chip
              key={p}
              label={PRINT_PURPOSE_LABELS_EN[p]}
              selected={purpose === p}
              onPress={() => {
                setPurpose(p);
                // Switching TO Assignment invalidates a "none" answer — the gap report
                // needs a real class/subject there, so make them re-answer rather than
                // carry a value the next screen would reject.
                if (p === ASSIGNMENT_NEEDS_REAL_TAGS) {
                  if (classId === NONE) setClassId(null);
                  if (subject === NONE) setSubject(null);
                }
              }}
            />
          ))}
        </ChipRow>
      </Card>

      {/* PQ-7 / D-#463 — which class and subject the print is for. An ANSWER is required;
          "no class" / "not subject-specific" are legitimate answers (an office notice
          belongs to none) — but not for an ASSIGNMENT, which the print-gap report matches
          on a real class+section+subject. */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prPickClass} *</Body>
        <ChipRow>
          {classes.map((c) => (
            <Chip
              key={c.id}
              label={classLevelLabel(c.level)}
              selected={classId === c.id}
              onPress={() => {
                setClassId(c.id);
                setSectionId(null); // re-picked below; auto-fills if the class has one section
              }}
            />
          ))}
          {purpose !== ASSIGNMENT_NEEDS_REAL_TAGS ? (
            <Chip
              label={STR.prNoClass}
              selected={classId === NONE}
              onPress={() => {
                setClassId(NONE);
                setSectionId(null);
              }}
            />
          ) : null}
        </ChipRow>
        {classId && classId !== NONE && activeSections.length > 1 ? (
          <>
            <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(2) }}>{STR.section}</Body>
            <ChipRow>
              {activeSections.map((s) => (
                <Chip
                  key={s.id}
                  label={s.nameBn || s.code}
                  selected={sectionId === s.id}
                  onPress={() => setSectionId(sectionId === s.id ? null : s.id)}
                />
              ))}
            </ChipRow>
          </>
        ) : null}
        <Body style={{ fontWeight: "700", marginTop: space(3), marginBottom: space(2) }}>
          {STR.hrCoverSubject} *
        </Body>
        <ChipRow>
          {ROUTINE_SUBJECTS.map((s) => (
            <Chip
              key={s}
              label={routineSubjectLabel(s)}
              selected={subject === s}
              onPress={() => setSubject(s)}
            />
          ))}
          {purpose !== ASSIGNMENT_NEEDS_REAL_TAGS ? (
            <Chip
              label={STR.prNoSubject}
              selected={subject === NONE}
              onPress={() => setSubject(NONE)}
            />
          ) : null}
        </ChipRow>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prSource}</Body>
        {sourceLocked ? (
          <Muted>{presetSource === "SET" ? STR.prSourceSet : STR.prSourcePlan}</Muted>
        ) : (
          <>
            <ChipRow>
              <Chip label={STR.prSourceUpload} selected={sourceType === "UPLOAD"} onPress={() => setSourceType("UPLOAD")} />
              <Chip label={STR.prSourceLink} selected={sourceType === "LINK"} onPress={() => setSourceType("LINK")} />
            </ChipRow>

            {sourceType === "UPLOAD" ? (
              <View style={{ marginTop: space(2), gap: space(1) }}>
                {files.map((f) => (
                  <View
                    key={f.fileId}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}
                  >
                    <Muted style={{ flex: 1 }}>📄 {f.originalName}</Muted>
                    <Button
                      title={STR.prRemove}
                      variant="danger"
                      onPress={() => removeFile(f.fileId)}
                      disabled={busy || uploading}
                    />
                  </View>
                ))}
                <UploadDropZone
                  onFiles={(dropped) => void onDropFiles(dropped)}
                  disabled={busy || uploading || files.length >= MAX_PRINT_UPLOADS}
                >
                  <Button
                    title={uploading ? STR.prUploading : STR.prPickFile}
                    variant="secondary"
                    onPress={onPickFile}
                    loading={uploading}
                    disabled={busy || uploading || files.length >= MAX_PRINT_UPLOADS}
                  />
                </UploadDropZone>
              </View>
            ) : (
              <View style={{ marginTop: space(2) }}>
                <Field
                  label={STR.prLinkUrl}
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://forms.gle/…"
                />
              </View>
            )}
          </>
        )}
      </Card>

      {/* Colour + sides are MANDATORY (live-testing requirement) — the Office cannot start
          a job without them, so nothing is pre-selected: the teacher must choose. */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prColour} *</Body>
        <ChipRow>
          {PRINT_COLOURS.map((c) => (
            <Chip key={c} label={PRINT_COLOUR_LABELS_EN[c]} selected={colour === c} onPress={() => setColour(c)} />
          ))}
        </ChipRow>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prSides} *</Body>
        <ChipRow>
          {PRINT_SIDES.map((sd) => (
            <Chip key={sd} label={PRINT_SIDES_LABELS_EN[sd]} selected={sides === sd} onPress={() => setSides(sd)} />
          ))}
        </ChipRow>
      </Card>

      {/* D-#294: copies — a typed number, OR one per student present in a class on the
          use day (the Office resolves the count from that day's attendance). */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prCopies} *</Body>
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
          <View style={{ marginTop: space(2) }}>
            <Field label={STR.prCopies} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
          </View>
        ) : (
          <View style={{ marginTop: space(2) }}>
            <Muted style={{ marginBottom: space(1) }}>{STR.prCopiesClassHint}</Muted>
            <ChipRow>
              {classes.map((c) => (
                <Chip
                  key={c.id}
                  label={classLevelLabel(c.level)}
                  selected={copiesClassId === c.id}
                  onPress={() => setCopiesClassId(c.id)}
                />
              ))}
            </ChipRow>
          </View>
        )}
      </Card>

      {/* The date the print will be USED — for CLASS_PRESENT jobs it also picks WHICH
          day's attendance determines the copy count (D-#294). */}
      <DateField label={`${STR.prUseDate} *`} value={neededByKey} onChange={setNeededByKey} />
      <Field label={STR.prNotes} value={notes} onChangeText={setNotes} multiline />

      <Button title={STR.prSend} onPress={onSubmit} loading={busy} />
      {/* Reached from "Send to print" on a Set/plan, this screen is a dead end on web —
          there is no header back arrow to change your mind with. */}
      <Button title={STR.cancel} variant="ghost" onPress={() => navigation.goBack()} disabled={busy} />
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
