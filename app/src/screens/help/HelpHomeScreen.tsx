/**
 * সাহায্য ও নির্দেশিকা (prd-help-centre §2.2, D-#968) — search + category cards of the
 * caller's own guides. The server already left out every guide the person may not see
 * (D-#969). A guide a newly granted permission unlocked carries "নতুন" (D-#972).
 *
 * Opened from a screen's header ? with several guides for that screen, it starts filtered
 * to them (`screenKey`), with a way back to all.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MARK_HELP_OPENED, MY_HELP_GUIDES, type HelpGuideT } from "../../graphql/help";
import { Badge, Body, Button, Card, EmptyState, H2, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { SearchField } from "../../components/SearchField";
import { bnDigits, guidesForScreen, searchGuides } from "../../lib/helpGuides";
import { STR } from "../../lib/labels";
import type { HelpStackParamList } from "../../navigation/types";
import { fonts, space, useColors } from "../../theme";

type Props = NativeStackScreenProps<HelpStackParamList, "HelpHome">;

function GuideLink({ g, onOpen }: { g: HelpGuideT; onOpen: () => void }): React.ReactElement {
  const colors = useColors();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="link"
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: space(2),
        alignItems: "center",
        paddingVertical: space(3),
        borderTopWidth: 1,
        borderTopColor: colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {/* 📖 = a reading guide (D-#1280); 📄 = a step guide with pictures. */}
      <Text style={{ fontSize: 16 }}>{g.kind === "read" ? "📖" : "📄"}</Text>
      <Text style={{ flex: 1, minWidth: 0, color: colors.textPrimary, fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 }}>
        {g.title}
      </Text>
      {g.isNew ? <Badge text={STR.hcNew} tone="warn" /> : null}
    </Pressable>
  );
}

export default function HelpHomeScreen({ navigation, route }: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: MY_HELP_GUIDES, requestPolicy: "cache-and-network" });
  const [, markOpened] = useMutation(MARK_HELP_OPENED);
  const [term, setTerm] = useState("");
  const [screenKey, setScreenKey] = useState(route.params?.screenKey ?? null);
  const colors = useColors();

  useEffect(() => setScreenKey(route.params?.screenKey ?? null), [route.params?.screenKey]);

  const data = q.data?.myHelpGuides;
  // The first open sets the নতুন baseline (nothing is "new" on day one). The server
  // ignores repeat calls, so every visit may call it.
  useEffect(() => {
    if (data?.firstOpen) void markOpened({}).then(() => refetch({ requestPolicy: "network-only" }));
  }, [data?.firstOpen, markOpened, refetch]);

  const guides = useMemo(() => {
    const all = data?.guides ?? [];
    return searchGuides(screenKey ? guidesForScreen(all, screenKey) : all, term);
  }, [data, screenKey, term]);

  const open = (g: HelpGuideT) => navigation.navigate("HelpGuide", { guideId: g.id });

  return (
    <Screen scroll>
      <View style={{ backgroundColor: colors.primary, borderRadius: 16, padding: space(6), gap: space(3), marginBottom: space(4) }}>
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 22, lineHeight: 30, textAlign: "center" }}>
          {STR.hcHero}
        </Text>
        <SearchField value={term} onSearch={setTerm} placeholder={STR.hcSearchPh} />
        <Text style={{ color: colors.onPrimary, opacity: 0.85, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" }}>
          {STR.hcSearchHint}
        </Text>
      </View>

      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })}>
        {data ? (
          <>
            <View style={{ gap: space(1), marginBottom: space(3) }}>
              <Body style={{ fontFamily: fonts.bold }}>
                {term || screenKey ? STR.hcResults : STR.hcCount.replace("{n}", bnDigits(data.guides.length))}
              </Body>
              <Muted>{screenKey ? STR.hcThisScreen : STR.hcCountHint}</Muted>
              {screenKey ? <Button title={STR.hcShowAll} variant="ghost" onPress={() => setScreenKey(null)} /> : null}
            </View>

            {data.guides.length === 0 ? <EmptyState message={STR.hcEmpty} /> : null}
            {data.guides.length > 0 && guides.length === 0 ? (
              <EmptyState message={STR.hcNoResults.replace("{q}", term)} />
            ) : null}

            {term || screenKey
              ? guides.map((g) => (
                  <Card key={g.id} onPress={() => open(g)}>
                    <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                      <Body style={{ flex: 1, minWidth: 0, fontFamily: fonts.bold }}>{g.title}</Body>
                      {g.isNew ? <Badge text={STR.hcNew} tone="warn" /> : null}
                    </View>
                    <Muted>{data.categories.find((c) => c.id === g.category)?.title ?? ""}</Muted>
                  </Card>
                ))
              : data.categories.map((c) => {
                  const inCat = guides.filter((g) => g.category === c.id);
                  if (inCat.length === 0) return null;
                  return (
                    <Card key={c.id}>
                      <H2>{c.title}</H2>
                      <Muted style={{ marginBottom: space(1) }}>{STR.hcCatCount.replace("{n}", bnDigits(inCat.length))}</Muted>
                      {inCat.map((g) => (
                        <GuideLink key={g.id} g={g} onOpen={() => open(g)} />
                      ))}
                    </Card>
                  );
                })}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
