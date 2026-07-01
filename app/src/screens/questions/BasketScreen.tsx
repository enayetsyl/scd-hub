/**
 * BasketScreen (S6 / J3.1–J3.2 entry) — review the working basket, pick a set
 * type (HW/AS/CT), then createSet for the selected section and push each basket
 * item via addQuestionToSet. On success the basket clears and we hand off to
 * AssembleSet (Sets tab) for per-type metadata + finalising. A writable section
 * must be chosen first (Sets tab → Section picker) — createSet is write-scoped.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useMutation } from "urql";
import { SET_TYPES } from "@scd/shared";
import { CREATE_SET, ADD_QUESTION_TO_SET } from "../../graphql/operations";
import type { QuestionsStackParamList, TabParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Button,
  Notice,
  EmptyState,
  Divider,
  Row,
} from "../../components/ui";
import { STR, setTypeLabel, bnNum, classLevelLabel } from "../../lib/labels";
import { getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useBasket } from "../../state/BasketContext";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<QuestionsStackParamList, "Basket">;

export default function BasketScreen(_props: Props): React.ReactElement {
  const basket = useBasket();
  const { selection, hasSection } = useSectionContext();
  const lang = getActiveLang();
  const tabNav = useNavigation<NavigationProp<TabParamList>>();
  const [setType, setSetType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, createSet] = useMutation(CREATE_SET);
  const [, addQuestion] = useMutation(ADD_QUESTION_TO_SET);

  // Guard (J3): a set targets one section/class, so the basket's question class level must
  // match the selected section's class. Class filter (question bank) and section (set target)
  // are decoupled, so a Class-5 basket can land on a Class-3 section silently — block that.
  const basketLevels = Array.from(new Set(basket.items.map((i) => i.classLevel)));
  const classMismatch =
    hasSection &&
    selection.classLevel != null &&
    basketLevels.some((l) => l !== selection.classLevel);

  async function onCreate(): Promise<void> {
    if (!setType || !hasSection || basket.count === 0 || busy || classMismatch) return;
    setBusy(true);
    setError(null);

    const created = await createSet({
      setType,
      sectionId: selection.sectionId!,
      classId: selection.classId!,
    });
    if (created.error || !created.data?.createSet) {
      setError(friendlyError(created.error));
      setBusy(false);
      return;
    }
    const setId = created.data.createSet.id;

    for (const item of basket.items) {
      const r = await addQuestion({ setId, artifactId: item.artifactId });
      if (r.error) {
        setError(friendlyError(r.error));
        setBusy(false);
        return;
      }
    }

    basket.clear();
    setBusy(false);
    tabNav.navigate("SetsTab", { screen: "AssembleSet", params: { setId, setType } });
  }

  return (
    <Screen scroll>
      <H2>{STR.basket}</H2>

      {basket.count === 0 ? (
        <EmptyState message={STR.basketEmpty} />
      ) : (
        <>
          {basket.items.map((item) => (
            <Card key={item.artifactId}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1 }}>{item.label}</Body>
                <Muted>
                  {bnNum(item.marks)} {STR.marks}
                </Muted>
              </View>
              <Button title={STR.remove} variant="ghost" onPress={() => basket.remove(item.artifactId)} />
            </Card>
          ))}

          <Row label={STR.totalMarks} value={bnNum(basket.totalMarks)} />
          <Divider />

          <Muted>{STR.setType}</Muted>
          <ChipRow>
            {SET_TYPES.map((t) => (
              <Chip key={t} label={setTypeLabel(t)} selected={setType === t} onPress={() => setSetType(setType === t ? null : t)} />
            ))}
          </ChipRow>

          {hasSection ? (
            <Muted style={{ marginBottom: space(2) }}>
              {STR.section}: {lang === "en" ? classLevelLabel(selection.classLevel ?? 0) : selection.classNameBn} ·{" "}
              {lang === "en" ? selection.sectionCode ?? selection.sectionNameBn : selection.sectionNameBn}
            </Muted>
          ) : (
            <View>
              <Notice message={STR.noSectionSelected} tone="warn" />
              <Button
                title={STR.pickSection}
                variant="secondary"
                onPress={() => tabNav.navigate("SetsTab", { screen: "SectionPicker" })}
              />
            </View>
          )}

          {classMismatch ? (
            <View style={{ marginBottom: space(2) }}>
              <Notice
                message={`${STR.classMismatchWarn} (${basketLevels.map(classLevelLabel).join(", ")} → ${classLevelLabel(selection.classLevel!)})`}
                tone="danger"
              />
              <Button
                title={STR.changeSection}
                variant="secondary"
                onPress={() => tabNav.navigate("SetsTab", { screen: "SectionPicker" })}
              />
            </View>
          ) : null}

          {error ? <Notice message={error} tone="danger" /> : null}

          <Button
            title={busy ? STR.saving : STR.createSet}
            onPress={onCreate}
            loading={busy}
            disabled={!setType || !hasSection || basket.count === 0 || classMismatch}
            style={{ marginTop: space(3) }}
          />
        </>
      )}
    </Screen>
  );
}
