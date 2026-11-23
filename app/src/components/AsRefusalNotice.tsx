/**
 * AsRefusalNotice (AL-6b, AC-C12) — a refusal from the weekly-assignment flow, shown as the server worded it.
 * When it is the "one assignment per week × শাখা × subject" refusal, a button leads to the extra-homework screen
 * ("দুর্বলদের বাড়তি বাড়ির কাজ") for mid-week help. Without mastery access the button is left out; the sentence stays.
 */
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { Button, Notice } from "./ui";
import { STR } from "../lib/labels";
import { isSecondAssignmentRefusal } from "../lib/asRefusal";
import { useAuth } from "../auth/AuthContext";
import { space } from "../theme/tokens";

type CrossNav = { navigate: (name: string, params?: object) => void };

export function AsRefusalNotice({ message, sectionId, subject }: { message: string; sectionId: string; subject: string }): React.ReactElement {
  const { can } = useAuth();
  const nav = useNavigation() as unknown as CrossNav;
  const second = isSecondAssignmentRefusal(message) && can("mastery:create") && can("mastery:view");
  return (
    <>
      <Notice message={message} tone="danger" />
      {second ? (
        <Button
          title={STR.msExtraButton}
          variant="secondary"
          style={{ marginBottom: space(2) }}
          onPress={() => nav.navigate("MasteryTab", { screen: "MasteryExtraHomework", params: { sectionId, subject }, initial: false })}
        />
      ) : null}
    </>
  );
}
