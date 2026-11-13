/**
 * S12 বান্ডেল (docs/prd-book-lifecycle.md §8, §15.4): বান্ডেল নামান — pick items + instructions (+ "ছবিও দিন")
 * → a zip for a chat without MCP; ফলাফল তুলুন — a `book-edit-result/v1` answer (paste or a .json/.md
 * file), or a whole `master.md` + `changes.json` → the same draft → S11.
 */
import React, { useState } from "react";
import { Platform, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BL_FEEDBACK } from "../../graphql/bookLifecycle";
import { BL_ADD_INSTRUCTION, BL_INSTRUCTIONS, BL_UPLOAD_RESULT } from "../../graphql/bookLifecycleEdit";
import { Body, Button, Card, Chip, ChipRow, Field, Muted, Screen } from "../../components/ui";
import { friendlyError } from "../../lib/errors";
import { downloadBookLcBundle, pickBookLcFile, postBookLc, readPickedText, type BlAsset } from "../../lib/bookLcFiles";
import type { BookLcStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { SectionTitle, useMsg } from "./blCommon";

type Props = NativeStackScreenProps<BookLcStackParamList, "BookLcBundle">;

export default function BookLcBundleScreen({ navigation, route }: Props): React.ReactElement {
  const { bookId } = route.params;
  const [fq] = useQuery({ query: BL_FEEDBACK, variables: { bookId, status: "active", page: 1, pageSize: 200 } });
  const [iq, refetchI] = useQuery({ query: BL_INSTRUCTIONS, variables: { bookId, page: 1, pageSize: 100 } });
  const [, addInstruction] = useMutation(BL_ADD_INSTRUCTION);
  const [, uploadResult] = useMutation(BL_UPLOAD_RESULT);
  const [items, setItems] = useState<string[]>([]);
  const [instr, setInstr] = useState<string[]>([]);
  const [media, setMedia] = useState(false);
  const [newInstr, setNewInstr] = useState("");
  const [needsReview, setNeedsReview] = useState(true);
  const [paste, setPaste] = useState("");
  const [nonce, setNonce] = useState("");
  const [master, setMaster] = useState<BlAsset | null>(null);
  const [changes, setChanges] = useState<BlAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useMsg();
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const toDraft = (draftId: string) => navigation.navigate("BookLcDraft", { draftId });

  const download = async (): Promise<void> => {
    if (Platform.OS !== "web") return setMsg({ tone: "info", text: BL.webOnly });
    setBusy(true);
    try {
      const r = await downloadBookLcBundle({ bookId, feedback: items, instructionIds: instr, includeMedia: media });
      setNonce(r.nonce);
      setMsg({ tone: "ok", text: `${BL.bundleReady} ${r.nonce}` });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      {msg}
      <SectionTitle>{BL.bundleDownload}</SectionTitle>
      <Muted>{BL.bundleHint}</Muted>
      <ChipRow>
        {(fq.data?.bookLcFeedbackPage.rows ?? []).map((f) => (
          <Chip key={f.id} label={`${f.code} ${f.textBn.slice(0, 24)}`} selected={items.includes(f.code)} onPress={() => toggle(items, setItems, f.code)} />
        ))}
      </ChipRow>
      <ChipRow>
        {(iq.data?.bookLcInstructionsPage.rows ?? []).map((i) => (
          <Chip key={i.id} label={`${i.code} ${i.textBn.slice(0, 24)}`} selected={instr.includes(i.id)} onPress={() => toggle(instr, setInstr, i.id)} />
        ))}
      </ChipRow>
      <Card style={{ marginTop: space(2) }}>
        <Field label={BL.newInstruction} value={newInstr} onChangeText={setNewInstr} multiline autoCapitalize="sentences" />
        <ChipRow>
          <Chip label={BL.needsReview} selected={needsReview} onPress={() => setNeedsReview(!needsReview)} />
        </ChipRow>
        <Button
          title={BL.addRow}
          variant="ghost"
          onPress={() =>
            void addInstruction({ bookId, textBn: newInstr, needsReview }).then((r) => (r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : (setNewInstr(""), refetchI({ requestPolicy: "network-only" }))))
          }
        />
      </Card>
      <ChipRow>
        <Chip label={BL.withPictures} selected={media} onPress={() => setMedia(!media)} />
      </ChipRow>
      <Button title={BL.bundleDownload} loading={busy} onPress={() => void download()} />

      <SectionTitle>{BL.bundleUpload}</SectionTitle>
      <Card>
        <Field label={BL.pasteResult} value={paste} onChangeText={setPaste} multiline />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
          <Button
            title={BL.pickResultFile}
            variant="ghost"
            onPress={() => void pickBookLcFile("any").then(async (a) => a && setPaste(await readPickedText(a)))}
          />
          <Button
            title={BL.uploadResult}
            onPress={() =>
              void uploadResult({ bookId, text: paste }).then((r) => (r.error ? setMsg({ tone: "danger", text: friendlyError(r.error) }) : toDraft(r.data!.uploadBookLcBundleResult.draftId)))
            }
          />
        </View>
      </Card>
      <Card style={{ marginTop: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{BL.wholeUpload}</Body>
        <Field label={BL.bundleNonce} value={nonce} onChangeText={setNonce} />
        <Button title={master ? `${BL.picked}: ${master.name}` : "master.md"} variant="ghost" onPress={() => void pickBookLcFile("md").then((a) => a && setMaster(a))} />
        <Button title={changes ? `${BL.picked}: ${changes.name}` : "changes.json"} variant="ghost" onPress={() => void pickBookLcFile("any").then((a) => a && setChanges(a))} />
        <Button
          title={BL.uploadResult}
          onPress={() =>
            void postBookLc<{ draftId: string }>("bundle-whole", { bookId, nonce }, { master, changes })
              .then((r) => toDraft(r.draftId))
              .catch((e) => setMsg({ tone: "danger", text: (e as Error).message }))
          }
        />
      </Card>
    </Screen>
  );
}
