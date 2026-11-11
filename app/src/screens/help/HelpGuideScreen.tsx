/**
 * One help guide (prd-help-centre §2.3, D-#968): title, why the person sees it, then one
 * card per screen with the numbered steps above the screenshot and its red boxes. Tapping
 * a step (or a box) lights that box and fades the rest; tapping again shows all.
 * Footer: keywords, কাজে লেগেছে? হ্যাঁ / না, and এই পাতায় যান (opens the real screen).
 *
 * A reading guide (kind "read", D-#1280) shows its text sections instead of the screen cards.
 *
 * Opening the guide clears its নতুন badge (D-#972). The guide comes from the same cached
 * myHelpGuides list, so a guide the person may not see is simply not found.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { HELP_GUIDE_FEEDBACK, MARK_HELP_GUIDE_READ, MY_HELP_GUIDES } from "../../graphql/help";
import { Body, Button, Card, EmptyState, H1, H2, Muted, Screen } from "../../components/ui";
import { HelpShot } from "../../components/HelpShot";
import { HelpReadSections } from "../../components/HelpReadSections";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { bnDigits, stepSegments } from "../../lib/helpGuides";
import { STR } from "../../lib/labels";
import type { HelpStackParamList } from "../../navigation/types";
import { fonts, radius, space, useColors } from "../../theme";

type Props = NativeStackScreenProps<HelpStackParamList, "HelpGuide">;

export default function HelpGuideScreen({ navigation, route }: Props): React.ReactElement {
  const { guideId } = route.params;
  const [q, refetch] = useQuery({ query: MY_HELP_GUIDES, requestPolicy: "cache-first" });
  const [, markRead] = useMutation(MARK_HELP_GUIDE_READ);
  const [fb, sendFeedback] = useMutation(HELP_GUIDE_FEEDBACK);
  const [answered, setAnswered] = useState<boolean | null>(null);
  // Which step is lit, as "<row>:<step>"; null = all boxes on.
  const [active, setActive] = useState<string | null>(null);
  const { role } = useAuth();
  const colors = useColors();

  const data = q.data?.myHelpGuides;
  const guide = data?.guides.find((g) => g.id === guideId) ?? null;
  const category = data?.categories.find((c) => c.id === guide?.category)?.title ?? "";
  // D-#1280: a reading guide is text sections instead of screenshot rows.
  const isRead = guide?.kind === "read";

  useEffect(() => {
    if (guide) void markRead({ guideId: guide.id });
    // Once per opened guide: the server ignores a repeat.
  }, [guide?.id, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (guide) navigation.setOptions({ title: guide.title });
  }, [guide, navigation]);

  const firstNo = useMemo(() => {
    const out: number[] = [];
    let n = 1;
    for (const r of guide?.rows ?? []) {
      out.push(n);
      n += r.steps.length;
    }
    return out;
  }, [guide]);

  const why = guide?.unlockedBy
    ? STR.hcWhyPerm.replace("{p}", guide.unlockedBy)
    : role === "GUARDIAN"
      ? STR.hcWhyGuardian
      : STR.hcWhyStaff;

  const toggle = (key: string) => setActive((cur) => (cur === key ? null : key));

  const goTo = () => {
    if (!guide?.goToRoute) return;
    const nav = navigation as unknown as { navigate: (route: string, params?: object) => void };
    nav.navigate(guide.goToRoute, guide.goToScreen ? { screen: guide.goToScreen } : undefined);
  };

  const answer = (helpful: boolean) => {
    if (!guide) return;
    setAnswered(helpful);
    void sendFeedback({ guideId: guide.id, helpful });
  };

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {data && !guide ? <EmptyState message={STR.hcGuideMissing} /> : null}
        {guide ? (
          <View style={{ gap: space(4) }}>
            <View style={{ gap: space(2) }}>
              <Muted>{category}</Muted>
              <H1>{guide.title}</H1>
              <View
                style={{
                  alignSelf: "flex-start",
                  backgroundColor: colors.infoContainer,
                  borderRadius: radius.sm,
                  paddingVertical: space(1),
                  paddingHorizontal: space(3),
                }}
              >
                <Text style={{ color: colors.info, fontFamily: fonts.medium, fontSize: 13, lineHeight: 20 }}>🔑 {why}</Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontFamily: fonts.regular, fontStyle: "italic", fontSize: 16, lineHeight: 24 }}>
                {guide.intro}
              </Text>
              {isRead ? null : <Muted>{STR.hcTapStepHint}</Muted>}
            </View>

            {isRead ? <HelpReadSections sections={guide.sections ?? []} /> : null}

            {guide.rows.map((r, ri) => {
              const litHere = active?.startsWith(`${ri}:`) ? Number(active.split(":")[1]) : null;
              return (
                <Card key={ri}>
                  <H2>{r.heading}</H2>
                  <View style={{ gap: space(1), marginVertical: space(3) }}>
                    {r.steps.map((s, si) => {
                      const no = bnDigits(firstNo[ri] + si);
                      const on = litHere === si;
                      return (
                        <Pressable
                          key={si}
                          onPress={() => toggle(`${ri}:${si}`)}
                          accessibilityRole="button"
                          style={{
                            flexDirection: "row",
                            gap: space(3),
                            alignItems: "flex-start",
                            padding: space(2),
                            borderRadius: radius.sm,
                            borderWidth: 1,
                            borderColor: on ? colors.error : "transparent",
                            backgroundColor: on ? colors.errorContainer : "transparent",
                          }}
                        >
                          <View
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 13,
                              backgroundColor: colors.error,
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 1,
                            }}
                          >
                            <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }}>{no}</Text>
                          </View>
                          <Text style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 }}>
                            {stepSegments(s.text, no).map((seg, k) => (
                              <Text key={k} style={seg.bold ? { fontFamily: fonts.bold } : undefined}>
                                {seg.text}
                              </Text>
                            ))}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <HelpShot row={r} firstStepNo={firstNo[ri]} active={litHere} onPressStep={(si) => toggle(`${ri}:${si}`)} />
                </Card>
              );
            })}

            <Card>
              {guide.keywords.length ? (
                <Muted>
                  {STR.hcKeywords}: {guide.keywords.join(", ")}
                </Muted>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) }}>
                <Body>{STR.hcHelpful}</Body>
                <Button title={STR.hcYes} variant={answered === true ? "primary" : "secondary"} onPress={() => answer(true)} loading={fb.fetching && answered === true} />
                <Button title={STR.hcNo} variant={answered === false ? "primary" : "secondary"} onPress={() => answer(false)} loading={fb.fetching && answered === false} />
              </View>
              {answered !== null && !fb.fetching ? <Muted style={{ marginTop: space(2) }}>{STR.hcThanks}</Muted> : null}
              {guide.goToRoute ? <Button title={STR.hcGoTo} onPress={goTo} style={{ marginTop: space(3) }} /> : null}
            </Card>
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
