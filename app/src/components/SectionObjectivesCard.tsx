/**
 * SectionObjectivesCard (OT-5, prd-objective-tree §8.3) — on the lesson tracker: this শাখা × subject
 * per objective row — taught on / not yet, absent that day. Self-contained (its own query, the
 * tracker's row rule on the server); renders nothing until a plan or the catalogue carries codes.
 */
import React from "react";
import { useQuery } from "urql";
import { LESSON_OBJECTIVE_STATUS_QUERY } from "../graphql/operations";
import { Card, Body, Muted } from "./ui";
import { ObjectiveStatusRows } from "./ObjectiveStatusRows";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { fill } from "../screens/mastery/masteryStateUi";
import { useMasteryLevelLabels } from "../lib/useMasteryLevelLabels";

export function SectionObjectivesCard({ sectionId, subject }: { sectionId: string; subject: string }): React.ReactElement | null {
  const [q] = useQuery({ query: LESSON_OBJECTIVE_STATUS_QUERY, variables: { sectionId, subject }, requestPolicy: "cache-and-network" });
  const levels = useMasteryLevelLabels();
  const rows = q.data?.lessonObjectiveStatus ?? [];
  if (q.error) {
    return (
      <Card>
        <Muted>⚠ {friendlyError(q.error)}</Muted>
      </Card>
    );
  }
  if (rows.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{fill(STR.otSectionCardTitle, { level: levels.objective })}</Body>
      <ObjectiveStatusRows rows={rows} />
    </Card>
  );
}
