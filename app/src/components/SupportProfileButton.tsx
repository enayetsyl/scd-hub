/**
 * The support-profile entry on a teacher surface (docs/prd-child-support-profile.md §9.1; D-#1557).
 * Renders nothing unless the existence chip (not audited, no content) says this caller may read a
 * PUBLISHED profile of the child. Pressing it opens the card in the home stack; that open is audited.
 */
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { SUPPORT_CHIPS } from "../graphql/supportProfile";
import { useAuth } from "../auth/AuthContext";
import { Button, Chip, ChipRow } from "./ui";
import { STR } from "../lib/labels";

type Via = "ROUTINE" | "ATTENDANCE" | "CLASS_NOTE" | "CLASS_TEST" | "STUDENT_PAGE";

export function SupportProfileButton({ studentId, via, compact = false }: { studentId: string; via: Via; compact?: boolean }): React.ReactElement | null {
  const { can } = useAuth();
  const allowed = can("support_profile:view") || can("support_profile:view_all");
  const nav = useNavigation();
  const [q] = useQuery<{ supportProfileChips: string[] }>({ query: SUPPORT_CHIPS, variables: { studentIds: [studentId] }, pause: !allowed || !studentId });
  if (!allowed || !q.data?.supportProfileChips.includes(studentId)) return null;
  const open = () => {
    const parent = nav.getParent() as unknown as { navigate: (r: string, p: unknown) => void } | undefined;
    (parent ?? (nav as unknown as { navigate: (r: string, p: unknown) => void })).navigate("HomeTab", { screen: "SupportCard", params: { studentId, via } });
  };
  return <Button title={compact ? "🌱" : STR.supTitle} variant="secondary" onPress={open} />;
}

/** A roster row (attendance, class-test entry): ONE chip query for the whole list, then a small button
 *  per child who has a published profile this caller may read. Nothing renders for anyone else. */
export function SupportProfileRow({ students, via }: { students: { id: string; name: string }[]; via: Via }): React.ReactElement | null {
  const { can } = useAuth();
  const allowed = can("support_profile:view") || can("support_profile:view_all");
  const nav = useNavigation();
  const ids = students.map((s) => s.id);
  const [q] = useQuery<{ supportProfileChips: string[] }>({ query: SUPPORT_CHIPS, variables: { studentIds: ids }, pause: !allowed || ids.length === 0 });
  const withProfile = students.filter((s) => q.data?.supportProfileChips.includes(s.id));
  if (!allowed || withProfile.length === 0) return null;
  const parent = nav.getParent() as unknown as { navigate: (r: string, p: unknown) => void } | undefined;
  const go = (studentId: string) => (parent ?? (nav as unknown as { navigate: (r: string, p: unknown) => void })).navigate("HomeTab", { screen: "SupportCard", params: { studentId, via } });
  return (
    <ChipRow>
      {withProfile.map((s) => (
        <Chip key={s.id} label={`🌱 ${s.name}`} onPress={() => go(s.id)} />
      ))}
    </ChipRow>
  );
}
