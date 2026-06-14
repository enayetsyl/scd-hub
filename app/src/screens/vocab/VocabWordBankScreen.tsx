/**
 * VocabWordBankScreen (VC-5 / J1) — manage a (program × classLevel) word bank.
 * Browse rides tracker:read; add/edit/(de)activate ride tracker:write + the
 * server-side class-level reach gate (assertCanManageClassLevel) — the screen shows
 * the controls and surfaces the Bangla deny if the role/scope can't perform it.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  VOCAB_WORDS_QUERY,
  ADD_VOCAB_WORD,
  EDIT_VOCAB_WORD,
  SET_VOCAB_WORD_ACTIVE,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Badge, Chip, Loader, Notice } from "../../components/ui";
import { ProgramSelect, ClassLevelSelect } from "../../components/vocabPickers";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

export default function VocabWordBankScreen(): React.ReactElement {
  const [program, setProgram] = useState<string | null>(null);
  const [classLevelStr, setClassLevelStr] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const classLevel = classLevelStr != null ? Number(classLevelStr) : null;
  const ready = !!program && classLevel != null;

  const [wordsQ, refetch] = useQuery({
    query: VOCAB_WORDS_QUERY,
    variables: { program: program ?? "", classLevel: classLevel ?? 0, includeInactive: showInactive },
    pause: !ready,
  });
  const words = wordsQ.data?.vocabWords ?? [];

  const [, addWord] = useMutation(ADD_VOCAB_WORD);
  const [, editWord] = useMutation(EDIT_VOCAB_WORD);
  const [, setActive] = useMutation(SET_VOCAB_WORD_ACTIVE);

  const [headword, setHeadword] = useState("");
  const [meaning, setMeaning] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm(): void {
    setHeadword("");
    setMeaning("");
    setEditId(null);
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!ready || !headword.trim() || !meaning.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = editId
      ? await editWord({ wordId: editId, headword: headword.trim(), banglaMeaning: meaning.trim() })
      : await addWord({ program: program!, classLevel: classLevel!, headword: headword.trim(), banglaMeaning: meaning.trim() });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOk(editId ? STR.vbWordUpdated : STR.vbWordAdded);
    resetForm();
    refetch({ requestPolicy: "network-only" });
  }

  async function onToggleActive(wordId: string, active: boolean): Promise<void> {
    setError(null);
    setOk(null);
    const res = await setActive({ wordId, active });
    if (res.error) return setError(friendlyError(res.error));
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.vbWordBankTitle}</Body>
          <ProgramSelect value={program} onChange={(v) => setProgram(v)} />
          <ClassLevelSelect value={classLevelStr} onChange={(v) => setClassLevelStr(v)} />
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {ready ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700", marginBottom: space(2) }}>
                {editId ? STR.vbEdit : STR.vbAddWord}
              </Body>
              <Field label={STR.vbHeadword} value={headword} onChangeText={setHeadword} autoCapitalize="none" />
              <Field label={STR.vbBanglaMeaning} value={meaning} onChangeText={setMeaning} />
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                <Button title={editId ? STR.save : STR.add} onPress={onSubmit} loading={busy} disabled={busy} />
                {editId ? <Button title={STR.cancel} variant="ghost" onPress={resetForm} /> : null}
              </View>
            </Card>

            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.vbWordBank}</Body>
                <Chip
                  label={STR.vbShowInactive}
                  selected={showInactive}
                  onPress={() => setShowInactive((s) => !s)}
                />
              </View>
              {wordsQ.fetching ? (
                <Loader label={STR.loading} />
              ) : words.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.vbNoWords}</Muted>
              ) : (
                words.map((w) => (
                  <View
                    key={w.id}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Body>
                        {w.headword} — {w.banglaMeaning}
                      </Body>
                      {!w.active ? <Badge text={STR.vbInactiveBadge} tone="muted" /> : null}
                    </View>
                    <View style={{ flexDirection: "row", gap: space(2) }}>
                      <Chip
                        label={STR.vbEdit}
                        onPress={() => {
                          setEditId(w.id);
                          setHeadword(w.headword);
                          setMeaning(w.banglaMeaning);
                        }}
                      />
                      <Chip
                        label={w.active ? STR.vbDeactivate : STR.vbReactivate}
                        onPress={() => void onToggleActive(w.id, !w.active)}
                      />
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
