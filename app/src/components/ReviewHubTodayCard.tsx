/**
 * ReviewHubTodayCard (H-1, .claude/plans/review-hub-and-quality.md) — "পর্যালোচনা বাকি: N" on the
 * Today screens. One tap opens "আমার পর্যালোচনা", the one list of everything the caller still has
 * to review. Self-contained (own query), so it sits OUTSIDE TodayScreen's QueryGate and survives an
 * empty day. Renders nothing while loading, on error, or when nothing is owed — a broken or empty
 * card must never break Today.
 */
import React from "react";
import { Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_REVIEW_HUB } from "../graphql/reviewHub";
import { useAuth } from "../auth/AuthContext";
import { REVIEW_HOME_PERMS } from "../lib/reviewHubPerms";
import type { TabParamList } from "../navigation/types";
import { Badge, Card } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { makeStyles, space, typeScale } from "../theme";

export function ReviewHubTodayCard(): React.ReactElement | null {
  const styles = useStyles();
  const { can } = useAuth();
  const nav = useNavigation<NavigationProp<TabParamList>>();
  const [q] = useQuery({ query: MY_REVIEW_HUB, requestPolicy: "cache-and-network" });
  if (q.error || !q.data) return null;
  const left = q.data.myReviewHub.totalLeft;
  if (left <= 0) return null;

  // Without ReviewHome in their reach, keep the hub as the stack's first screen: Back then leaves
  // the tab instead of landing on an empty ReviewHome.
  const hasHome = REVIEW_HOME_PERMS.some((p) => can(p));
  const open = (): void =>
    (nav.navigate as unknown as (name: string, p?: object) => void)(
      "ReviewTab",
      hasHome ? { screen: "ReviewHub", initial: false } : { screen: "ReviewHub" },
    );

  return (
    <Card onPress={open}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={2}>
          {STR.rhTodayCard}: {bnNum(left)}
        </Text>
        <Badge text={STR.rhNav} tone="brand" />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) },
  title: { ...typeScale.bodyStrong, flex: 1, color: c.textPrimary },
}));
