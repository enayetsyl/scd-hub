/**
 * ContentTreeScreen (S2 / J1.5–J1.6) — browse Subject×Class → Chapter → Lesson.
 * Filter chips: subject / classLevel (sent to contentTree) + curationTag
 * (applied client-side; contentTree has no curationTag arg). Plans only —
 * questions/stimuli live in the Questions tab. Scope is enforced server-side,
 * so a supervisory teacher naturally sees content beyond their teaching sections.
 */
import React, { useState, useMemo, useRef, useCallback } from "react";
import { View, ScrollView, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { SUBJECTS, CLASS_LEVELS, CURATION_TAGS, PLAN_DOC_TYPES } from "@scd/shared";
import { CONTENT_TREE_QUERY } from "../../graphql/operations";
import type { ContentStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  curationTagLabel,
  reviewStatusLabel,
  docTypeLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ContentStackParamList, "ContentTree">;

const PLAN_TYPES = new Set<string>(PLAN_DOC_TYPES);

function reviewTone(status: string): "ok" | "brand" | "muted" {
  return status === "gold" ? "ok" : status === "reviewed" ? "brand" : "muted";
}

export default function ContentTreeScreen({ navigation }: Props): React.ReactElement {
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [curationTag, setCurationTag] = useState<string | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // One-line summary of the active filters, shown in the collapsed accordion header
  // so it's clear what's applied without expanding it.
  const activeFilters = useMemo(
    () =>
      [
        subject ? subjectLabel(subject) : null,
        classLevel != null ? classLevelLabel(classLevel) : null,
        docType ? docTypeLabel(docType) : null,
        curationTag ? curationTagLabel(curationTag) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [subject, classLevel, docType, curationTag],
  );

  const [{ data, fetching, error }, refetch] = useQuery({
    query: CONTENT_TREE_QUERY,
    variables: { subject, classLevel },
  });

  // Re-fetch whenever the tab regains focus (e.g. after an Admin → Import) so a
  // freshly imported plan appears without a full app reload. The initial mount
  // already fetches via useQuery, so skip the first focus to avoid a double hit.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const nodes = data?.contentTree ?? [];

  const filtered = useMemo(
    () =>
      nodes
        .map((n) => ({
          ...n,
          chapters: n.chapters
            .map((c) => ({
              ...c,
              artifacts: c.artifacts.filter(
                (a) =>
                  PLAN_TYPES.has(a.docType) &&
                  (!curationTag || a.curationTag === curationTag) &&
                  (!docType || a.docType === docType),
              ),
            }))
            .filter((c) => c.artifacts.length > 0),
        }))
        .filter((n) => n.chapters.length > 0),
    [nodes, curationTag, docType],
  );

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: filtersOpen ? 0 : space(2) }}>
        <Pressable
          onPress={() => setFiltersOpen((o) => !o)}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(1) }}
        >
          <Body style={{ fontWeight: "700" }}>{STR.filters}</Body>
          {!filtersOpen && activeFilters ? (
            <Muted style={{ flex: 1 }}>{activeFilters}</Muted>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Body style={{ fontWeight: "700" }}>{filtersOpen ? "▾" : "▸"}</Body>
        </Pressable>

        {filtersOpen ? (
        <>
        <Muted>{STR.subject}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={subject === null} onPress={() => setSubject(null)} />
          {SUBJECTS.map((s) => (
            <Chip
              key={s}
              label={subjectLabel(s)}
              selected={subject === s}
              onPress={() => setSubject(subject === s ? null : s)}
            />
          ))}
        </ChipRow>

        <Muted>{STR.classLevel}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={classLevel === null} onPress={() => setClassLevel(null)} />
          {CLASS_LEVELS.map((c) => (
            <Chip
              key={c}
              label={bnNum(c)}
              selected={classLevel === c}
              onPress={() => setClassLevel(classLevel === c ? null : c)}
            />
          ))}
        </ChipRow>

        <Muted>{STR.planType}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={docType === null} onPress={() => setDocType(null)} />
          {PLAN_DOC_TYPES.map((t) => (
            <Chip
              key={t}
              label={docTypeLabel(t)}
              selected={docType === t}
              onPress={() => setDocType(docType === t ? null : t)}
            />
          ))}
        </ChipRow>

        <Muted>{STR.curationTag}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={curationTag === null} onPress={() => setCurationTag(null)} />
          {CURATION_TAGS.map((t) => (
            <Chip
              key={t}
              label={curationTagLabel(t)}
              selected={curationTag === t}
              onPress={() => setCurationTag(curationTag === t ? null : t)}
            />
          ))}
        </ChipRow>
        </>
        ) : null}
      </View>

      {error ? (
        <View style={{ paddingHorizontal: space(4) }}>
          <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        </View>
      ) : null}

      {fetching ? (
        <Loader label={STR.loading} />
      ) : filtered.length === 0 ? (
        <EmptyState message={STR.empty} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space(4) }}>
          {filtered.map((node) => (
            <View key={`${node.subject}:${node.classLevel}`} style={{ marginBottom: space(4) }}>
              <H2>
                {subjectLabel(node.subject)} · {classLevelLabel(node.classLevel)}
              </H2>
              {node.chapters.map((ch) => (
                <View key={`${ch.anchorWord}:${ch.number}`} style={{ marginTop: space(2) }}>
                  <Muted style={{ marginBottom: space(1) }}>
                    {ch.anchorWord} {bnNum(ch.number)}
                    {ch.title ? ` — ${ch.title}` : ""}
                  </Muted>
                  {ch.artifacts.map((a) => (
                    <Card key={a.id} onPress={() => navigation.navigate("PlanView", { artifactId: a.id })}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                        <Body style={{ flex: 1, fontWeight: "600" }}>
                          {a.address.title || `${a.address.anchorWord} ${a.address.number}`}
                        </Body>
                        <Badge text={reviewStatusLabel(a.reviewStatus)} tone={reviewTone(a.reviewStatus)} />
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}>
                        <Badge text={docTypeLabel(a.docType)} tone="info" />
                        <Muted>{curationTagLabel(a.curationTag)}</Muted>
                      </View>
                    </Card>
                  ))}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
