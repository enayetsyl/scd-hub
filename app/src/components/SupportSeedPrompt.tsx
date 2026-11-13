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
import { ANSWER_SUPPORT_SEED, OFFER_SUPPORT_SEED, RAISE_SAFEGUARDING } from "../graphql/supportProfile";
import { useAuth } from "../auth/AuthContext";
import { Body, Button, Card, Field, Muted } from "./ui";
import { STR } from "../lib/labels";
import { useToast } from "../state/ToastContext";
import { friendlyError } from "../lib/errors";
import { space } from "../theme/tokens";

export function SupportSeedPrompt({ commentId }: { commentId: string | null }): React.ReactElement | null {
  const { can } = useAuth();
  const nav = useNavigation();
  const [offer, setOffer] = useState<{ offered: boolean; safeguardingFirst: boolean; praise: boolean; studentId?: string | null } | null>(null);
  const [, doOffer] = useMutation(OFFER_SUPPORT_SEED);
  const [, answer] = useMutation(ANSWER_SUPPORT_SEED);
  const [, raise] = useMutation(RAISE_SAFEGUARDING);
  const toast = useToast();
  const [sgDone, setSgDone] = useState(false);
  const [sgText, setSgText] = useState("");
  const [sgOpen, setSgOpen] = useState(false);
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
  // §7.4: a serious-matter comment gets the safety question FIRST; the report offer comes after it.
  if (offer.safeguardingFirst && !sgDone) {
    return (
      <Card>
        <Body style={{ fontWeight: "700" }}>{SAFEGUARDING_QUESTION_BN}</Body>
        <Muted>{STR.supSgSeriousFirst}</Muted>
        {sgOpen ? <Field label={STR.supSgText} value={sgText} onChangeText={setSgText} multiline /> : null}
        <View style={{ gap: space(2), marginTop: space(2) }}>
          <Button
            title={STR.supSgRaise}
            variant="danger"
            onPress={async () => {
              if (!sgOpen) return setSgOpen(true);
              const r = await raise({ studentId: offer.studentId ?? "", textBn: sgText });
              if (r.error) return toast.show(friendlyError(r.error), "danger");
              toast.show(STR.supSgRouted, "ok");
              setSgDone(true);
            }}
          />
          <Button title={STR.supSgNo} variant="secondary" onPress={() => setSgDone(true)} />
        </View>
      </Card>
    );
  }
  return (
    <Card>
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
