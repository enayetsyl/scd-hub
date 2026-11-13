/**
 * The prepare dry run (YC-5): refusals in red, warnings, a per-class counts table, and the engine's
 * full printed text (children by school ID) behind a toggle.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { YcPlanT } from "../../../graphql/yearChange";
import { Body, Button, Card, H2, Muted, Notice } from "../../../components/ui";
import { STR, bnNum, classLevelLabel } from "../../../lib/labels";
import { space } from "../../../theme/tokens";

const secLabel = (code: string): string => (code === "Main" ? STR.ycSecMain : code === "Boys" ? STR.ycSecBoys : code === "Girls" ? STR.ycSecGirls : code);

export function PlanView({ plan }: { plan: YcPlanT }): React.ReactElement {
  const [full, setFull] = useState(false);
  const c = plan.counts;
  return (
    <View style={{ gap: space(2) }}>
      <H2>{`${plan.fromLabel} → ${plan.toLabel}`}</H2>
      <Muted>{`${STR.ycStarts} ${plan.startKey} · ${STR.ycOldEnds} ${plan.closeKey}`}</Muted>
      {plan.refusals.map((r, i) => (
        <Notice key={`r${i}`} message={r} tone="danger" />
      ))}
      {plan.warnings.map((w, i) => (
        <Notice key={`w${i}`} message={w} tone="warn" />
      ))}
      {plan.removeAdmissions.length + plan.removeEnrolments.length > 0 ? (
        <Notice
          tone="danger"
          message={`${STR.ycReconcileTitle}: ${[
            plan.removeAdmissions.length ? `${bnNum(plan.removeAdmissions.length)}${STR.ycWillDeleteAdm} (${plan.removeAdmissions.map((r) => r.schoolId).join(", ")})` : "",
            plan.removeEnrolments.length ? `${bnNum(plan.removeEnrolments.length)}${STR.ycWillDeleteEnrol} (${plan.removeEnrolments.map((r) => `${r.schoolId}${r.reason ? ` - ${r.reason}` : ""}`).join(", ")})` : "",
          ]
            .filter(Boolean)
            .join("; ")}`}
        />
      ) : null}
      {plan.enrolments.some((e) => e.update) || plan.admissions.some((a) => a.changed) ? (
        <Notice
          tone="warn"
          message={`${STR.ycReconcileTitle}: ${[
            plan.enrolments.some((e) => e.update) ? `${bnNum(plan.enrolments.filter((e) => e.update).length)}${STR.ycWillMoveEnrol} (${plan.enrolments.filter((e) => e.update).map((e) => e.schoolId).join(", ")})` : "",
            plan.admissions.some((a) => a.changed) ? `${bnNum(plan.admissions.filter((a) => a.changed).length)}${STR.ycWillEditAdm} (${plan.admissions.filter((a) => a.changed).map((a) => a.schoolId).join(", ")})` : "",
          ]
            .filter(Boolean)
            .join("; ")}`}
        />
      ) : null}
      {plan.refusals.length === 0 ? <Notice message={STR.ycNoBlock} tone="ok" /> : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.ycTotals}</Body>
        <Muted>
          {`${STR.ycPromote} ${bnNum(c.promoted)} · ${STR.ycRepeat} ${bnNum(c.repeaters)} · ${STR.ycLeft} ${bnNum(c.left)} · ${STR.ycAdmitted} ${bnNum(c.admissionsToCreate + c.admissionsExisting)}`}
        </Muted>
        <Muted>
          {`${STR.ycNewClasses} ${bnNum(c.classesToCreate)} · ${STR.ycNewSections} ${bnNum(c.sectionsToCreate)} · ${STR.ycTeachersSet} ${bnNum(c.classTeachersToSet)}`}
        </Muted>
      </Card>

      {plan.classes.map((k) => (
        <Card key={k.level}>
          <Body style={{ fontWeight: "700" }}>
            {classLevelLabel(k.level)}
            {k.existingId ? "" : ` (${STR.ycNew})`} — {bnNum(k.total)} {STR.ycChildrenWord}
          </Body>
          <Muted>{k.sections.map((s) => `${secLabel(s.code)} ${bnNum(s.children)}`).join(" | ")}</Muted>
          <Muted>
            {`${STR.ycPromote} ${bnNum(k.promotedIn)} · ${STR.ycRepeat} ${bnNum(k.repeaters)} · ${STR.ycAdmitted} ${bnNum(k.admissions)} · ${STR.ycLeavesThis} ${bnNum(k.left)}`}
          </Muted>
        </Card>
      ))}

      <Button title={full ? STR.ycHideDetail : STR.ycShowDetail} variant="ghost" onPress={() => setFull((v) => !v)} />
      {full ? (
        <Card>
          <Body>{plan.printText}</Body>
        </Card>
      ) : null}
    </View>
  );
}
