/**
 * The comment → report prompt (docs/prd-child-support-profile.md §7.4; D-#1561). Shown on the comment's
 * saved screen. The server decides whether to offer it (author, sentiment, current reader, feature on)
 * and stores no text. এখন লিখুন opens the seeded draft; পরে keeps it in "আমার রিপোর্ট" for 7 days; না
 * closes it. A SERIOUS_MATTER comment shows the safety line first.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation } from "urql";
import { SAFEGUARDING_QUESTION_BN } from "@scd/shared";
import { ANSWER_SUPPORT_SEED, OFFER_SUPPORT_SEED } from "../graphql/supportProfile";
import { useAuth } from "../auth/AuthContext";
import { Body, Button, Card, Muted } from "./ui";
import { STR } from "../lib/labels";
import { space } from "../theme/tokens";

export function SupportSeedPrompt({ commentId }: { commentId: string | null }): React.ReactElement | null {
  const { can } = useAuth();
  const nav = useNavigation();
  const [offer, setOffer] = useState<{ offered: boolean; safeguardingFirst: boolean; praise: boolean } | null>(null);
  const [, doOffer] = useMutation(OFFER_SUPPORT_SEED);
  const [, answer] = useMutation(ANSWER_SUPPORT_SEED);
  useEffect(() => {
    if (!commentId || !can("support_profile:report")) return;
    void doOffer({ commentId }).then((r) => setOffer(r.data?.offerSupportSeed ?? null));
  }, [commentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!commentId || !offer?.offered) return null;
  const choose = async (choice: "NOW" | "LATER" | "NO") => {
    const r = await answer({ commentId, choice });
    setOffer(null);
    const draft = r.data?.answerSupportSeed.draft;
    if (choice === "NOW" && draft) {
      const parent = nav.getParent() as unknown as { navigate: (n: string, p: unknown) => void } | undefined;
      (parent ?? (nav as unknown as { navigate: (n: string, p: unknown) => void })).navigate("HomeTab", { screen: "SupportReportForm", params: { studentId: draft.studentId, reportId: draft.id } });
    }
  };
  return (
    <Card>
      {offer.safeguardingFirst ? <Body style={{ fontWeight: "700" }}>{`${SAFEGUARDING_QUESTION_BN} — ${STR.supSgFormLine}`}</Body> : null}
      <Body>{STR.supSeedAsk}</Body>
      {offer.praise ? <Muted>{STR.supSeedPraiseHelp}</Muted> : null}
      <View style={{ gap: space(2), marginTop: space(2) }}>
        <Button title={STR.supSeedNow} onPress={() => choose("NOW")} />
        <Button title={STR.supSeedLater} variant="secondary" onPress={() => choose("LATER")} />
        <Button title={STR.supSeedNo} variant="ghost" onPress={() => choose("NO")} />
      </View>
    </Card>
  );
}
