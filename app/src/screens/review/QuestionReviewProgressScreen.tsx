/**
 * QuestionReviewProgressScreen (QR-5, Q5.1; D-#537) — "I gave Kaynat class 5. What now?"
 *
 * The assign screen answers what was handed out and the publish screen answers what is
 * ready to go out, but neither answers the question the Principal actually asks a week
 * later, which is about a PERSON: how far has this reviewer got, and which way did they
 * rule? This screen is that view — one card per reviewer, four tappable counters each.
 *
 * Counts arrive bucketed by VERDICT rather than by round status (see the service), so a
 * reviewer's approvals do not drain away as the Principal publishes them.
 */
import React, { useState, useCallback } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { SUBJECTS, CLASS_LEVELS } from "@scd/shared";
import {
  QUESTION_REVIEWER_PROGRESS,
  QUESTION_COVERAGE,
  QUESTION_REVIEWER_SLICES,
  type ReviewerSliceT,
  type QuestionReviewerProgressT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewProgress">;

export default function QuestionReviewProgressScreen({ navigation }: Props): React.ReactElement {
  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  /** The chapter axis (QR-13, D-#567) — “what did I assign her for chapter 23”. */
  const [chapter, setChapter] = useState<number | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTION_REVIEWER_PROGRESS,
    variables: { subject, classLevel, chapter },
  });

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  /** Coverage for the SLICE, not for any one reviewer — so it sits above the cards. */
  const [coverageQ] = useQuery({
    query: QUESTION_COVERAGE,
    variables: { subject, classLevel, chapter },
  });
  const coverage = coverageQ.data?.questionCoverage ?? null;

  /**
   * Slices come from the ASSIGNMENTS, not the bank (D-#568). The bank query is publish-gated
   * and answers “what chapters EXIST”; the question on this screen is “what did I hand out”.
   * One query feeds BOTH the chapter chips and the per-reviewer breakdown rows below.
   */
  const [slicesQ] = useQuery({
    query: QUESTION_REVIEWER_SLICES,
    variables: { subject, classLevel },
  });
  const slices: ReviewerSliceT[] = slicesQ.data?.questionReviewerSlices ?? [];

  /** Chapters actually ASSIGNED in this scope, numerically ordered. */
  const chapterOptions = [
    ...new Set(slices.map((s) => Number(s.chapter)).filter((n) => Number.isInteger(n) && n > 0)),
  ].sort((a, b) => a - b);

  /** Grouped for the rows inside each reviewer card. */
  const slicesByReviewer = new Map<string, ReviewerSliceT[]>();
  for (const s of slices) {
    const list = slicesByReviewer.get(s.reviewerId) ?? [];
    list.push(s);
    slicesByReviewer.set(s.reviewerId, list);
  }

  const rows = data?.questionReviewerProgress ?? [];

  return (
    <Screen scroll>
      <H2>{STR.qpTitle}</H2>
      <Muted>{STR.qpSubtitle}</Muted>

      <View style={{ height: space(3) }} />
      <ChipRow>
        <Chip label={STR.all} selected={classLevel === null} onPress={() => { setClassLevel(null); setChapter(null); }} />
        {CLASS_LEVELS.map((c) => (
          <Chip
            key={c}
            label={classLevelLabel(c)}
            selected={classLevel === c}
            onPress={() => { setClassLevel(classLevel === c ? null : c); setChapter(null); }}
          />
        ))}
      </ChipRow>
      <ChipRow>
        <Chip label={STR.all} selected={subject === null} onPress={() => { setSubject(null); setChapter(null); }} />
        {SUBJECTS.map((s) => (
          <Chip
            key={s}
            label={subjectLabel(s)}
            selected={subject === s}
            onPress={() => { setSubject(subject === s ? null : s); setChapter(null); }}
          />
        ))}
      </ChipRow>
      {chapterOptions.length > 0 ? (
        <ChipRow>
          <Chip label={STR.all} selected={chapter === null} onPress={() => setChapter(null)} />
          {chapterOptions.map((c) => (
            <Chip key={c} label={bnNum(c)} selected={chapter === c} onPress={() => setChapter(chapter === c ? null : c)} />
          ))}
        </ChipRow>
      ) : null}

      {/* Coverage for the SLICE (QR-13, D-#567). The reviewer cards below say how the
          ASSIGNED work is going; this says how much of the subject was assigned at all —
          without it a reviewer at 13% reads the same whether she holds the whole subject
          or a tenth of it. Deliberately above the cards, because it is not about any one
          reviewer. */}
      {coverage ? (
        <View style={{ marginTop: space(3) }}>
          <Card>
            <Muted>{STR.qcTitle}</Muted>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), marginTop: space(2) }}>
              <CoverStat label={STR.qcInBank} n={coverage.inBank} />
              <CoverStat label={STR.qcAssigned} n={coverage.assigned} />
              <CoverStat label={STR.qcNotAssigned} n={coverage.notAssigned} warn={coverage.notAssigned > 0} />
              <CoverStat label={STR.qcReviewed} n={coverage.reviewed} />
              <CoverStat label={STR.qcPublished} n={coverage.published} />
              </View>
          </Card>
        </View>
      ) : null}

      <View style={{ height: space(3) }} />
      {error ? (
        <ErrorBanner
          message={friendlyError(error)}
          onRetry={() => refetch({ requestPolicy: "network-only" })}
        />
      ) : fetching && rows.length === 0 ? (
        <Loader label={STR.loading} />
      ) : rows.length === 0 ? (
        <EmptyState message={STR.qpNoReviewers} />
      ) : (
        rows.map((r) => (
          <ReviewerCard
            key={r.reviewerId}
            row={r}
            slices={slicesByReviewer.get(r.reviewerId) ?? []}
            onOpen={(bucket) =>
              navigation.navigate("QuestionReviewerRounds", {
                reviewerId: r.reviewerId,
                reviewerName: r.reviewerName,
                bucket,
                classLevel,
                subject,
              })
            }
          />
        ))
      )}
    </Screen>
  );
}

function ReviewerCard({
  row,
  slices,
  onOpen,
}: {
  row: QuestionReviewerProgressT;
  slices: ReviewerSliceT[];
  onOpen: (bucket: string) => void;
}): React.ReactElement {
  const colors = useColors();
  // Progress is decided/assigned, NOT decided/(assigned−cancelled): a round that closed
  // undecided is work that was handed over and never came back, and hiding it from the
  // denominator would round the bar up to a completeness nobody achieved.
  const pct = row.assigned === 0 ? 0 : Math.round((row.decided / row.assigned) * 100);

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{row.reviewerName ?? "—"}</Body>
        <Muted>{`${bnNum(row.assigned)} ${STR.qpAssigned} · ${bnNum(row.decided)} ${STR.qpDecided}`}</Muted>
      </View>

      <View
        style={{
          height: space(2),
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceAlt,
          overflow: "hidden",
          marginTop: space(2),
        }}
      >
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: colors.primary }} />
      </View>
      <Muted style={{ marginTop: space(1) }}>{`${bnNum(pct)}%`}</Muted>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: space(2) }}>
        <Counter label={STR.qpApproved} n={row.approved} tone="ok" onPress={() => onOpen("APPROVE")} />
        <Counter
          label={STR.qpWithCondition}
          n={row.approvedWithCondition}
          tone="warn"
          onPress={() => onOpen("APPROVE_WITH_CONDITION")}
        />
        <Counter
          label={STR.qpRejected}
          n={row.rejected}
          tone="danger"
          onPress={() => onOpen("CHANGES_REQUESTED")}
        />
        <Counter label={STR.qpPending} n={row.pending} tone="muted" onPress={() => onOpen("PENDING")} />
        {/* Shown ONLY when it is non-zero. It is the bucket that needs explaining, and a
            permanent "0 closed undecided" on every card would teach the Principal to
            stop reading the row. */}
        {row.cancelled > 0 ? (
          <Counter
            label={STR.qpCancelled}
            n={row.cancelled}
            tone="muted"
            onPress={() => onOpen("CANCELLED")}
          />
        ) : null}
      </View>

      {/* Which slices this reviewer actually holds (QR-14, D-#568). The counters above say
          how MUCH; without this, “which chapters did I give her” meant tapping through every
          subject × class combination and reading the headline each time. Counts are ROUNDS,
          so these rows sum to the assigned total on this same card. */}
      {slices.length > 0 ? (
        <View style={{ marginTop: space(3) }}>
          <Muted style={{ fontWeight: "700" }}>{STR.qpSlices}</Muted>
          {slices.map((s) => (
            <View
              key={`${s.subject}-${s.classLevel}-${s.chapter}`}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: space(1),
              }}
            >
              <Body style={{ flexShrink: 1 }}>
                {subjectLabel(s.subject)} · {classLevelLabel(s.classLevel)} · {STR.qbChapter} {bnNum(Number(s.chapter) || 0)}
              </Body>
              <Muted>
                {bnNum(s.decided)}/{bnNum(s.assigned)}
              </Muted>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** One tappable counter. The number is the drill-down's entry point, so a zero stays
 *  visible but is not pressable — an empty list is a dead end, not an answer. */
function Counter({
  label,
  n,
  tone,
  onPress,
}: {
  label: string;
  n: number;
  tone: "ok" | "warn" | "danger" | "muted";
  onPress: () => void;
}): React.ReactElement {
  const colors = useColors();
  const fg = {
    ok: colors.primary,
    warn: colors.warning,
    danger: colors.error,
    muted: colors.textSecondary,
  }[tone];

  return (
    <Card onPress={n > 0 ? onPress : undefined} style={{ marginRight: space(2), marginTop: space(2), flexGrow: 1, minWidth: 120 }}>
      <Body style={{ fontWeight: "700", color: fg }}>{bnNum(n)}</Body>
      <Muted>{label}</Muted>
    </Card>
  );
}

/**
 * One number on the coverage strip (QR-13, D-#567). Bangla numerals, because every other
 * count on this screen is — a Latin figure here would read as a different kind of thing.
 * `warn` tints only বরাদ্দ হয়নি: it is the one number that means work nobody has picked up.
 */
function CoverStat({ label, n, warn }: { label: string; n: number; warn?: boolean }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ minWidth: 92 }}>
      <Body style={{ fontWeight: "700", color: warn ? colors.warning : colors.textPrimary }}>{bnNum(n)}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}
