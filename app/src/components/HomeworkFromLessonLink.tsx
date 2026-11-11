/**
 * PR-D (D-#1321): on a published class note with a lesson marked, "এই পাঠের বাড়ির কাজ তৈরি করুন" opens
 * the new-sheet screen (homework) for that শাখা × subject × day, where "আজকের পাঠ থেকে খসড়া" drafts the
 * items. Shown only where the mastery add-on is switched on for the class × subject this year, and only to
 * someone who can build sheets (mastery:create). Renders nothing otherwise.
 */
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { MASTERY_SECTION_SWITCH_QUERY } from "../graphql/mastery";
import { Button } from "./ui";
import { STR } from "../lib/labels";
import { useAuth } from "../auth/AuthContext";
import { space } from "../theme/tokens";

type CrossNav = { navigate: (name: string, params?: object) => void };

export function HomeworkFromLessonLink({
  sectionId,
  subject,
  date,
  hasLesson,
}: {
  sectionId: string | null;
  subject: string;
  date: string;
  hasLesson: boolean;
}): React.ReactElement | null {
  const { can } = useAuth();
  const nav = useNavigation() as unknown as CrossNav;
  const show = !!sectionId && hasLesson && can("mastery:create") && can("mastery:view");
  const [{ data }] = useQuery({
    query: MASTERY_SECTION_SWITCH_QUERY,
    variables: { sectionId: sectionId ?? "", subject },
    pause: !show,
  });
  const sw = data?.masterySectionSwitch as { enabled: boolean; classLevel: number | null } | undefined;
  if (!show || !sw?.enabled || sw.classLevel === null) return null;
  return (
    <Button
      title={STR.ctnHomeworkFromLesson}
      variant="secondary"
      style={{ marginTop: space(2) }}
      onPress={() =>
        nav.navigate("MasteryTab", {
          screen: "MasteryNewPaper",
          params: { sectionId, subject, classLevel: sw.classLevel, date },
          initial: false,
        })
      }
    />
  );
}
