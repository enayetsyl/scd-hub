/**
 * BookImportScreen (SB-1, D-#406/#408) — how a book gets INTO the system.
 *
 * THIS IS STEP ONE OF THE WHOLE MODULE and it was missing: the queue, the review and
 * the assemble screens are all downstream of a book existing, and until now the only
 * way to put one there was a mutation typed into a terminal.
 *
 * ONE WRITE PATH (D-#408). This screen does not merge anything itself — it hands the
 * JSON to the same `submitSupportBookPatch` the desktop path uses, and renders what
 * comes back. There is no second implementation of "is this book valid" here, and there
 * must never be one.
 *
 * A RED IS AN OUTCOME, NOT AN ERROR. The server returns `merged:false` with findings
 * and stores the patch either way, so a refused submission is still a record of what
 * was tried. The screen shows the findings as the answer rather than as a failure —
 * an author whose patch bounced needs to read them, not dismiss a red banner.
 *
 * book.json vs patch envelope: the two shapes differ only by `patch_id` + `task`. A
 * full book.json is WRAPPED into an envelope, and the wrap is shown before submitting
 * rather than done invisibly — the patch id becomes the permanent name of this
 * submission, `(bookId, patchId)` is uniquely indexed, and a repeat upload is refused
 * on purpose. Naming it is the author's call, not a generated timestamp's.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import { BOOK_TYPES } from "@scd/shared";
import {
  SUPPORT_BOOKS, CREATE_SUPPORT_BOOK, SUBMIT_SUPPORT_BOOK_PATCH,
  type SupportBookT, type SupportBookMergeResultT, type SupportBookFindingT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, Chip, ChipRow, Field, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickJsonFile, FileUploadError } from "../../lib/files";
import { space, useColors } from "../../theme";

interface Parsed {
  kind: "book" | "patch";
  bookId: string;
  lessonCount: number;
  /** Present on a patch envelope; absent on a book.json, which is why it gets wrapped. */
  patchId: string | null;
  task: string | null;
  raw: Record<string, unknown>;
}

/**
 * Work out which of the two shapes this is. Both carry `book_id` + `lessons`; only a
 * patch carries `patch_id`. Deliberately structural rather than trusting a
 * `schema_version` string, because the thing that decides how it is submitted is what
 * the object actually contains.
 */
function parseJson(text: string): { ok: true; parsed: Parsed } | { ok: false; error: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: STR.sbNotJson };
  }
  if (!obj || typeof obj !== "object") return { ok: false, error: STR.sbNotJson };
  const o = obj as Record<string, unknown>;
  const lessons = o.lessons;
  if (!Array.isArray(lessons)) return { ok: false, error: STR.sbNoLessons };
  const bookId = typeof o.book_id === "string" ? o.book_id : "";
  if (!bookId) return { ok: false, error: "book_id" };
  const patchId = typeof o.patch_id === "string" ? o.patch_id : null;
  return {
    ok: true,
    parsed: {
      kind: patchId ? "patch" : "book",
      bookId,
      lessonCount: lessons.length,
      patchId,
      task: typeof o.task === "string" ? o.task : null,
      raw: o,
    },
  };
}

function FindingRow({ f }: { f: SupportBookFindingT }): React.ReactElement {
  const red = f.severity === "RED";
  // Where it is matters as much as what it is — "block b-12 of পাঠ ৭" is actionable,
  // "letter audit failed" is not.
  const where = [
    f.lessonNo != null ? `${STR.sbLesson} ${bnNum(f.lessonNo)}` : null,
    f.blockId,
    f.slotId,
    f.unit,
  ].filter(Boolean).join(" · ");
  return (
    <View style={{ paddingVertical: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Badge text={red ? STR.sbRed : STR.sbGrey} tone={red ? "danger" : "warn"} />
        <Body style={{ marginLeft: space(2), fontWeight: "700", fontSize: 13 }}>{f.check}</Body>
        {where ? <Muted style={{ marginLeft: space(2), fontSize: 12 }}>{where}</Muted> : null}
      </View>
      <Body style={{ fontSize: 13, marginTop: 2 }}>{f.message}</Body>
    </View>
  );
}

function ResultCard({ result }: { result: SupportBookMergeResultT }): React.ReactElement {
  const colors = useColors();
  // REDs first: they are the ones that refused the merge, and a list that buries them
  // under warnings makes the author scroll to find out why nothing happened.
  const findings = useMemo(
    () => [...result.findings].sort((a, b) => (a.severity === "RED" ? 0 : 1) - (b.severity === "RED" ? 0 : 1)),
    [result.findings],
  );

  return (
    <Card style={{ marginTop: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Badge text={result.merged ? STR.sbMerged : STR.sbNotMerged} tone={result.merged ? "ok" : "danger"} />
        <Muted style={{ marginLeft: space(2) }}>
          {`${STR.sbRed} ${bnNum(result.redCount)} · ${STR.sbGrey} ${bnNum(result.greyCount)}`}
        </Muted>
      </View>

      {result.lessonNos.length > 0 ? (
        <Muted style={{ marginTop: 4 }}>
          {`${STR.sbLessonsInPatch}: ${result.lessonNos.map((n) => bnNum(n)).join(", ")}`}
        </Muted>
      ) : null}

      {/* Surfaced, never swallowed: a patch validated against an INCOMPLETE policy set
          passed a weaker test than the author thinks it did (D-#403). */}
      {result.policyMissing.length > 0 ? (
        <Muted style={{ marginTop: 4, color: colors.warning }}>
          {`${STR.sbPolicyMissing}: ${result.policyMissing.join(", ")}`}
        </Muted>
      ) : null}

      <Divider />
      <Body style={{ fontWeight: "700" }}>{STR.sbFindings}</Body>
      {findings.length === 0 ? (
        <Muted>{STR.sbNoFindings}</Muted>
      ) : (
        findings.map((f, i) => <FindingRow key={`${i}-${f.check}`} f={f} />)
      )}
    </Card>
  );
}

function CreateBookCard({ onCreated }: { onCreated: () => void }): React.ReactElement {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [bookId, setBookId] = useState("");
  const [bookType, setBookType] = useState<string>(BOOK_TYPES[0]);
  const [classLevel, setClassLevel] = useState("");
  const [subject, setSubject] = useState("");
  const [titleBn, setTitleBn] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [res, createBook] = useMutation(CREATE_SUPPORT_BOOK);

  const level = Number(classLevel);
  const ready = !!bookId.trim() && !!subject.trim() && !!titleBn.trim() && Number.isInteger(level);

  async function onCreate(): Promise<void> {
    setNote(null);
    const r = await createBook({
      bookId: bookId.trim(),
      bookType,
      classLevel: level,
      subject: subject.trim(),
      titleBn: titleBn.trim(),
    });
    if (r.error) {
      setNote({ text: friendlyError(r.error), bad: true });
      return;
    }
    setNote({ text: STR.sbCreated, bad: false });
    setBookId(""); setSubject(""); setTitleBn(""); setClassLevel("");
    onCreated();
  }

  return (
    <Card style={{ marginTop: space(3) }}>
      <Button
        title={STR.sbCreateBook}
        variant="ghost"
        onPress={() => setOpen((v) => !v)}
        style={{ alignSelf: "flex-start" }}
      />
      {open ? (
        <>
          <Field label={STR.sbBookId} value={bookId} onChangeText={setBookId} placeholder="C1-BAN" />
          <Select
            label={STR.sbBookType}
            value={bookType}
            options={BOOK_TYPES.map((b) => ({ label: b, value: b }))}
            onChange={(v) => setBookType(v)}
          />
          <Field label={STR.sbClassLevel} value={classLevel} onChangeText={setClassLevel} keyboardType="number-pad" />
          <Field label={STR.sbSubject} value={subject} onChangeText={setSubject} placeholder="BAN" autoCapitalize="characters" />
          <Field label={STR.sbTitleBn} value={titleBn} onChangeText={setTitleBn} autoCapitalize="sentences" />
          <Button
            title={STR.sbCreate}
            onPress={() => { void onCreate(); }}
            loading={res.fetching}
            disabled={!ready || res.fetching}
            style={{ alignSelf: "flex-start", marginTop: space(2) }}
          />
          {note ? (
            <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
              {note.text}
            </Muted>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export default function BookImportScreen(): React.ReactElement {
  const colors = useColors();
  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [patchId, setPatchId] = useState("");
  const [task, setTask] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [result, setResult] = useState<SupportBookMergeResultT | null>(null);

  const [submitRes, submitPatch] = useMutation(SUBMIT_SUPPORT_BOOK_PATCH);

  const parsed = useMemo(() => (text.trim() ? parseJson(text) : null), [text]);
  const ok = parsed?.ok ? parsed.parsed : null;

  async function onPick(): Promise<void> {
    setNote(null);
    setResult(null);
    try {
      const f = await pickJsonFile();
      if (!f) return;
      setFileName(f.name);
      setText(f.text);
      // Seed the wrap fields from the file so the common case is one tap, while the
      // author can still name the submission something meaningful.
      const p = parseJson(f.text);
      if (p.ok && p.parsed.kind === "book") {
        setPatchId(`${p.parsed.bookId}-load-1`);
        setTask("initial load");
      } else if (p.ok) {
        setPatchId(p.parsed.patchId ?? "");
        setTask(p.parsed.task ?? "");
      }
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), bad: true });
    }
  }

  async function onSubmit(): Promise<void> {
    if (!ok) return;
    setNote(null);
    setResult(null);
    // The WRAP: a book.json becomes an envelope carrying the same lessons. Only the
    // two identifying fields are added — nothing about the content is touched, because
    // the validator must see exactly what the author wrote.
    const envelope =
      ok.kind === "patch"
        ? ok.raw
        : {
            schema_version: ok.raw.schema_version,
            book_id: ok.bookId,
            patch_id: patchId.trim(),
            task: task.trim(),
            lessons: ok.raw.lessons,
          };
    const r = await submitPatch({ patchJson: JSON.stringify(envelope), source: "DESKTOP_UPLOAD" });
    if (r.error) {
      setNote({ text: friendlyError(r.error), bad: true });
      return;
    }
    const out = (r.data as { submitSupportBookPatch?: SupportBookMergeResultT } | undefined)?.submitSupportBookPatch;
    if (out) {
      setResult(out);
      refetchBooks({ requestPolicy: "network-only" });
    }
  }

  const canSubmit =
    !!ok && !submitRes.fetching && (ok.kind === "patch" || (!!patchId.trim() && !!task.trim()));

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbImportTitle}</Body>
          <Muted>{STR.sbImportSub}</Muted>

          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: space(3) }}>
            <Button title={STR.sbPickJson} onPress={() => { void onPick(); }} />
            {fileName ? <Muted style={{ marginLeft: space(2) }}>{fileName}</Muted> : null}
          </View>

          <Field
            label={STR.sbPasteJson}
            value={text}
            onChangeText={(t) => { setText(t); setFileName(null); setResult(null); }}
            multiline
            inputStyle={{ minHeight: 120 }}
          />

          {parsed && !parsed.ok ? (
            <Muted style={{ color: colors.error }}>{parsed.error}</Muted>
          ) : null}

          {ok ? (
            <>
              <Divider />
              <Body style={{ fontWeight: "700" }}>{STR.sbWillSubmit}</Body>
              <Muted>{ok.kind === "book" ? STR.sbDetectedBook : STR.sbDetectedPatch}</Muted>
              <Muted>{`${STR.sbBookId}: ${ok.bookId} · ${STR.sbLessonsInPatch}: ${bnNum(ok.lessonCount)}`}</Muted>

              {ok.kind === "book" ? (
                <>
                  {/* Shown, not done silently: this id is the permanent name of the
                      submission and a repeat of it is refused by a unique index. */}
                  <Muted style={{ marginTop: 4 }}>{STR.sbWrapNote}</Muted>
                  <Field label={STR.sbPatchId} value={patchId} onChangeText={setPatchId} />
                  <Field label={STR.sbPatchTask} value={task} onChangeText={setTask} autoCapitalize="sentences" />
                </>
              ) : (
                <Muted>{`${STR.sbPatchId}: ${ok.patchId} · ${ok.task ?? ""}`}</Muted>
              )}

              <Button
                title={STR.sbSubmitPatch}
                onPress={() => { void onSubmit(); }}
                loading={submitRes.fetching}
                disabled={!canSubmit}
                style={{ alignSelf: "flex-start", marginTop: space(2) }}
              />
            </>
          ) : null}

          {note ? (
            <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
              {note.text}
            </Muted>
          ) : null}
        </Card>

        {result ? <ResultCard result={result} /> : null}

        <QueryGate
          results={[booksQ]}
          onRetry={() => refetchBooks({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
          <CreateBookCard onCreated={() => refetchBooks({ requestPolicy: "network-only" })} />
          <View style={{ marginTop: space(3) }}>
            <ChipRow>
              {(booksQ.data?.supportBooks ?? []).map((b) => (
                <Chip key={b.bookId} label={`${b.titleBn} · ${bnNum(b.lessonCount)}`} onPress={() => {}} />
              ))}
            </ChipRow>
          </View>
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
