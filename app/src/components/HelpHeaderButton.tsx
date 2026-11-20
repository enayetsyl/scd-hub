/**
 * The header ? (prd-help-centre §2.5, D-#968). It shows only on a screen that has guides
 * for this person (their own, server-filtered list), so every other header keeps its
 * width. One guide opens straight away; several open the help home filtered to them.
 *
 * The list is read ONCE, by HelpGuidesProvider above the navigators; every header reads
 * it from context. It used to be one useQuery per header (title + ? on every stacked
 * screen), and urql runs a mounting useQuery's first read during render: a navigation
 * that mounted several headers fanned the cached result out to every other header's
 * setState, synchronously, and crossed React's nested-update limit — "Minified React
 * error #185", a blank screen on web (GlitchTip #66/#68/#69/#75/#77).
 * A server without the help module (an app update that landed first) just returns an
 * error, and no ? is shown.
 */
import React, { createContext, useContext } from "react";
import { Pressable, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_HELP_GUIDES, type HelpGuideT } from "../graphql/help";
import { guidesForScreen } from "../lib/helpGuides";
import { STR } from "../lib/labels";
import { fonts } from "../theme";

/** This person's guides, or null while loading / on error / outside the provider. */
const HelpGuidesContext = createContext<HelpGuideT[] | null>(null);

/** Mounted once above the navigators: the one myHelpGuides read every header shares. */
export function HelpGuidesProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [q] = useQuery({ query: MY_HELP_GUIDES, requestPolicy: "cache-first" });
  return <HelpGuidesContext.Provider value={q.data?.myHelpGuides?.guides ?? null}>{children}</HelpGuidesContext.Provider>;
}

/** Guides whose `screens` list this `<Tab>/<Screen>` key. Empty while loading or on error. */
export function useScreenGuides(key: string | undefined): HelpGuideT[] {
  const guides = useContext(HelpGuidesContext);
  return key && guides ? guidesForScreen(guides, key) : [];
}

/** Width the ? takes in the header; HeaderTitle reserves it only when the ? is shown. */
export const HELP_BUTTON_WIDTH = 34;

export function HelpHeaderButton({ screenKey, tintColor }: { screenKey: string; tintColor?: string }): React.ReactElement | null {
  const navigation = useNavigation();
  const guides = useScreenGuides(screenKey);
  if (guides.length === 0) return null;
  const nav = navigation as unknown as { navigate: (route: string, params?: object) => void };
  const open = () =>
    guides.length === 1
      ? nav.navigate("HelpTab", { screen: "HelpGuide", params: { guideId: guides[0].id }, initial: false })
      : nav.navigate("HelpTab", { screen: "HelpHome", params: { screenKey } });
  return (
    <Pressable
      onPress={open}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={STR.hcHeaderButton}
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: tintColor,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 5,
      }}
    >
      <Text style={{ color: tintColor, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }}>?</Text>
    </Pressable>
  );
}
