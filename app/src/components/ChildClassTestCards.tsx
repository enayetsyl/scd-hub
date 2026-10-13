/**
 * Guardian class-test pieces shared by the Today screen and the Class Test tab
 * (D-#732), so the two never drift: the upcoming-tests card (D-#472) and one
 * published-result row (CT-5 / J7, D-#68; scripts CS-3, D-#716).
 *
 * Read-only by construction: the row renders a GuardianClassTestResultT, which has
 * no teacherAction field (the childTestResults query never fetches it).
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted, Card, Badge, Button, Divider } from "./ui";
import { STR, bnNum, hwSubjectLabel, isoDateLabel } from "../lib/labels";
import { openStoredFile, FILE_VIEW_SUPPORTED } from "../lib/files";
import type { ChildUpcomingClassTestT } from "../graphql/operations";
import type { GuardianClassTestResultT } from "../graphql/classTest";
import { space } from "../theme/tokens";

/** Confirmed class tests the child will sit — each row drops off once its day passes.
 *  Renders nothing when there are none, unless `emptyText` is given. */
export function UpcomingClassTestsCard({
  tests,
  emptyText,
}: {
  tests: ChildUpcomingClassTestT[];
  emptyText?: string;
}): React.ReactElement | null {
  if (tests.length === 0 && !emptyText) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.gpUpcomingTests}</Body>
      {tests.length === 0 ? <Muted>{emptyText}</Muted> : null}
      {tests.map((t, i) => (
        <View key={t.id} style={{ marginTop: i === 0 ? 0 : space(2) }}>
          {i === 0 ? null : <Divider />}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Body style={{ fontWeight: "700", flex: 1 }}>
              {t.subjectLabelBn}
              {t.testNumber ? ` · টেস্ট ${bnNum(t.testNumber)}` : ""}
            </Body>
            <Badge
              text={
                t.daysAway === 0
                  ? STR.gpTestToday
                  : t.daysAway === 1
                    ? STR.gpTestTomorrow
                    : `${bnNum(t.daysAway)} ${STR.gpTestInDays}`
              }
              tone={t.daysAway <= 1 ? "warn" : "info"}
            />
          </View>
          <Muted>{bnNum(t.examDate.slice(0, 10))}</Muted>
          {t.chapter ? (
            <Muted>
              {STR.gpChapter}: {t.chapter}
            </Muted>
          ) : null}
          <Muted>
            {t.totalMarks != null ? `${STR.gpMarks} ${bnNum(t.totalMarks)}` : ""}
            {t.totalMarks != null && t.durationMinutes != null ? " · " : ""}
            {t.durationMinutes != null ? `${bnNum(t.durationMinutes)} ${STR.gpMinutes}` : ""}
          </Muted>
        </View>
      ))}
    </Card>
  );
}

/** One published result. `showOutcome` adds the Pass / Needs-work badge and `isNew`
 *  the NEW tag — both used on the Class Test tab only. */
export function ClassTestResultRow({
  r,
  isNew = false,
  showOutcome = false,
  subjectName = hwSubjectLabel,
}: {
  r: GuardianClassTestResultT;
  isNew?: boolean;
  showOutcome?: boolean;
  /** How the subject is named — the Class Test tab passes its short names (BGS). */
  subjectName?: (code: string) => string;
}): React.ReactElement {
  const absent = r.status === "ABSENT";
  return (
    <View style={{ marginTop: space(2) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(2) }}>
            <Body>
              {subjectName(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
            </Body>
            {isNew ? <Badge text={STR.gctNew} tone="info" /> : null}
          </View>
          {/* D-#507: a group exam names the GROUP — a parent should not have
              to guess why an Arabic mark arrived with no class attached. */}
          <Muted>
            {isoDateLabel(r.examDate)}
            {r.groupNameBn ? ` · ${r.groupNameBn}` : ""}
          </Muted>
        </View>
        <View style={{ alignItems: "flex-end", gap: space(1) }}>
          <Badge
            text={
              absent
                ? STR.ctAbsent
                : `${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)}${r.percent == null ? "" : ` · ${bnNum(r.percent)}%`}`
            }
            tone={absent ? "muted" : r.pass ? "brand" : "danger"}
          />
          {showOutcome && !absent && r.pass !== null ? (
            <Badge text={r.pass ? STR.ctPass : STR.gctNeedsWork} tone={r.pass ? "ok" : "warn"} />
          ) : null}
        </View>
      </View>
      {r.weakness ? <Muted>{STR.ctWeakness}: {r.weakness}</Muted> : null}
      {r.guardianAction ? <Muted>{STR.ctGuardianAction}: {r.guardianAction}</Muted> : null}
      {/* CS-3 (D-#716): the scanned script, once the office has published it —
          one button per page; a "being scanned" line while it is at the office. */}
      {r.scriptPages.length > 0 && FILE_VIEW_SUPPORTED ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {r.scriptPages.map((p, i) => (
            <Button
              key={p.fileId}
              title={
                i === 0
                  ? `${STR.csViewScript}${r.scriptPages.length > 1 ? ` (${bnNum(r.scriptPages.length)} ${STR.csPage})` : ""}`
                  : `${STR.csPage} ${bnNum(i + 1)}`
              }
              variant={i === 0 ? "secondary" : "ghost"}
              onPress={() => void openStoredFile(p.fileId).catch(() => undefined)}
            />
          ))}
        </View>
      ) : r.scriptPending ? (
        <Muted style={{ marginTop: space(1) }}>{STR.csScanning}</Muted>
      ) : null}
    </View>
  );
}
