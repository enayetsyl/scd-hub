/**
 * নতুন বই / পুরোনো বই আনুন (docs/prd-book-lifecycle.md §4.4). A new book is an import at v1, draft;
 * an existing offline book comes in at its current number and state (past draft = finalize, D-#1617).
 */
import React, { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ROSTER_CLASS_LEVELS, ROUTINE_SUBJECTS } from "@scd/shared";
import { Button, Card, Field, Muted, Screen, Select } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { classLevelLabel, subjectLabel } from "../../lib/labels";
import { pickBookLcFile, postBookLc, type BlAsset } from "../../lib/bookLcFiles";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { useMsg } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcImport">;

export default function BookLcImportScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("1");
  const [subject, setSubject] = useState("BAN");
  const [titleBn, setTitleBn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [version, setVersion] = useState("v1");
  const [state, setState] = useState("draft");
  const [reviewer, setReviewer] = useState("");
  const [memoNo, setMemoNo] = useState("1");
  const [heading, setHeading] = useState("2");
  const [master, setMaster] = useState<BlAsset | null>(null);
  const [media, setMedia] = useState<BlAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useMsg();
  const finalize = can("book_lifecycle:finalize");
  const states = [
    { value: "draft", label: BL.stDrafting },
    ...(finalize ? [{ value: "approved", label: BL.stApproved }, { value: "final", label: BL.stFinal }, { value: "print_released", label: BL.stInUse }] : []),
  ];
  const go = async (): Promise<void> => {
    if (!master) return setMsg({ tone: "danger", text: BL.needMaster });
    setBusy(true);
    try {
      const r = await postBookLc<{ bookId: string }>(
        "import",
        { code: code.trim().toUpperCase(), classLevel: level, subject, titleBn, titleEn, version, state, reviewerName: reviewer, nextMemoNo: memoNo, chapterHeadingLevel: heading },
        { master, media },
      );
      navigation.replace("BookLcBook", { bookId: r.bookId });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen scroll>
      <Card>
        <Muted style={{ marginBottom: space(3) }}>{BL.importHint}</Muted>
        <Field label={BL.code} value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Select label={BL.classLevel} value={level} options={ROSTER_CLASS_LEVELS.map((l) => ({ value: String(l), label: classLevelLabel(l) }))} onChange={setLevel} />
        <Select label={BL.subject} value={subject} options={ROUTINE_SUBJECTS.map((s) => ({ value: s, label: subjectLabel(s) }))} onChange={setSubject} />
        <Field label={BL.titleBn} value={titleBn} onChangeText={setTitleBn} autoCapitalize="sentences" />
        <Field label={BL.titleEn} value={titleEn} onChangeText={setTitleEn} autoCapitalize="sentences" />
        <Field label={BL.versionNo} value={version} onChangeText={setVersion} />
        <Select label={BL.state} value={state} options={states} onChange={setState} />
        {state !== "draft" ? <Muted style={{ marginBottom: space(2) }}>{BL.importPastDraft}</Muted> : null}
        <Field label={BL.reviewerName} value={reviewer} onChangeText={setReviewer} autoCapitalize="words" helper={BL.reviewerNoLogin} />
        <Field label={BL.nextMemoNo} value={memoNo} onChangeText={setMemoNo} keyboardType="number-pad" />
        <Select label={BL.headingLevel} value={heading} options={["1", "2", "3"].map((v) => ({ value: v, label: "#".repeat(Number(v)) }))} onChange={setHeading} />
        <Button title={master ? `${BL.picked}: ${master.name}` : BL.pickMaster} variant="secondary" onPress={() => void pickBookLcFile("md").then((a) => a && setMaster(a))} />
        <Button title={media ? `${BL.picked}: ${media.name}` : BL.pickMedia} variant="ghost" onPress={() => void pickBookLcFile("zip").then((a) => a && setMedia(a))} style={{ marginTop: space(2) }} />
        {msg}
        <Button title={busy ? BL.importing : BL.doImport} loading={busy} onPress={() => void go()} style={{ marginTop: space(3) }} />
      </Card>
    </Screen>
  );
}
