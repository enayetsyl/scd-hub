/**
 * StoryShelfScreen (SB-1, W1) — the storybook catalogue.
 *
 *  - GUARDIAN: the selected child's age band only (published series), each card with how
 *    many of its books are in right now; tag chips and an "in now" filter.
 *  - STAFF (library:view): every series, drafts and hidden ones included.
 *  - OFFICE (library:edit): also opens "Series, tags & ages" (StoryManage).
 */
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { STORY_SHELF_QUERY, type StorySeriesCardT } from "../../graphql/storybooks";
import { Badge, Button, Chip, ChipRow, EmptyState, Loader, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useAuth } from "../../auth/AuthContext";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum } from "../../lib/labels";
import type { StorybooksStackParamList } from "../../navigation/types";
import { radius, space, typeScale, useColors } from "../../theme";
import { StoryImage } from "./StoryImage";

type Props = NativeStackScreenProps<StorybooksStackParamList, "StoryShelf">;

function SeriesCard({ card, staff, onPress }: { card: StorySeriesCardT; staff: boolean; onPress: () => void }): React.ReactElement {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={card.nameBn}
      style={{ flexBasis: "47%", flexGrow: 1, maxWidth: "50%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surface }}
    >
      <StoryImage fileId={card.coverFileId} style={{ borderWidth: 0, borderRadius: 0 }} />
      <View style={{ padding: space(2), gap: 2 }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }} numberOfLines={2}>
          {card.nameBn}
        </Text>
        <Muted style={{ fontSize: 12 }}>{STR.stbSeriesMeta.replace("{n}", bnNum(card.bookCount)).replace("{band}", card.ageBandLabel)}</Muted>
        <Muted style={{ fontSize: 12 }}>{STR.stbSeriesAvailable.replace("{n}", bnNum(card.availableBooks))}</Muted>
        {staff ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
            {card.status === "DRAFT" ? <Badge text={STR.stbDraft} tone="warn" /> : null}
            {card.status === "HIDDEN" ? <Badge text={STR.stbHidden} tone="muted" /> : null}
            {card.draftBooks > 0 ? <Badge text={STR.stbDraftsCount.replace("{n}", bnNum(card.draftBooks))} tone="info" /> : null}
            <Badge text={STR.stbCopiesCount.replace("{n}", bnNum(card.copyCount))} tone="muted" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function StoryShelfScreen({ navigation }: Props): React.ReactElement {
  const { role, can } = useAuth();
  const isGuardian = role === "GUARDIAN";
  const manage = !isGuardian && can("library:edit");
  const desk = !isGuardian && can("library:lend");
  const { selected } = useGuardianChild();
  const studentId = isGuardian ? selected?.studentId ?? null : null;

  const [q, refetch] = useQuery({
    query: STORY_SHELF_QUERY,
    variables: { studentId },
    pause: isGuardian && !studentId,
  });
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, reload);
  const [tag, setTag] = useState<string | "all" | "in">("all");

  const cards = useMemo(() => q.data?.storyShelf ?? [], [q.data]);
  const tags = useMemo(() => [...new Set(cards.flatMap((c) => c.tagNamesBn))].sort(), [cards]);
  const shown = useMemo(() => {
    if (tag === "all") return cards;
    if (tag === "in") return cards.filter((c) => c.availableBooks > 0);
    return cards.filter((c) => c.tagNamesBn.includes(tag));
  }, [cards, tag]);
  const bandLabel = cards[0]?.ageBandLabel;

  return (
    <Screen padded={false}>
      {isGuardian ? (
        <View style={{ padding: space(4), paddingBottom: 0 }}>
          <ChildSwitcher />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {isGuardian && selected && bandLabel ? (
          <Notice tone="info" message={STR.stbBandBanner.replace("{name}", selected.nameBn || selected.name).replace("{band}", bandLabel)} />
        ) : null}
        {!isGuardian ? <Notice tone="info" message={STR.stbStaffHint} /> : null}
        {desk ? <Button title={STR.stbDeskNav} onPress={() => navigation.navigate("StoryDesk")} style={{ marginBottom: space(2) }} /> : null}
        {manage ? <Button title={STR.stbManage} variant="secondary" onPress={() => navigation.navigate("StoryManage")} style={{ marginBottom: space(3) }} /> : null}
        {cards.length > 0 ? (
          <ChipRow>
            <Chip label={STR.all} selected={tag === "all"} onPress={() => setTag("all")} />
            <Chip label={STR.stbFilterAvailable} selected={tag === "in"} onPress={() => setTag("in")} />
            {tags.map((t) => (
              <Chip key={t} label={t} selected={tag === t} onPress={() => setTag(t)} />
            ))}
          </ChipRow>
        ) : null}
        {isGuardian && !selected ? (
          <Loader label={STR.loading} />
        ) : (
          <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
            {shown.length === 0 ? (
              <EmptyState message={isGuardian ? STR.stbEmptyGuardian : STR.stbEmptyStaff} />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(3) }}>
                {shown.map((c) => (
                  <SeriesCard key={c.id} card={c} staff={!isGuardian} onPress={() => navigation.navigate("StorySeries", { seriesId: c.id, title: c.nameBn })} />
                ))}
              </View>
            )}
          </QueryGate>
        )}
      </ScrollView>
    </Screen>
  );
}
