/**
 * Step 1 of the year change - Prepare (YC-5, docs/prd-year-change.md section 3).
 *
 * The Principal picks the two years, the classes and sections of the new year, who is promoted /
 * repeats / has left (children listed by SCHOOL ID - no roll numbers, D-#1463), the admissions,
 * the class teachers and the copy options. "ড্রাই রান দেখুন" shows the engine's plan; "চালু করুন"
 * writes it - and only for the SAME input that was dry-run. The draft lives in component state;
 * the server is the source of truth after the apply.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import {
  APPLY_YEAR_CHANGE_PREPARE,
  YEAR_CHANGE_PLAN_QUERY,
  YEAR_CHANGE_SETUP_QUERY,
  type DecisionT,
  type SectionCodeT,
  type YcPlanInput,
  type YcPlanT,
  type YcSetupT,
} from "../../../graphql/yearChange";
import { Body, Button, Card, Chip, ChipRow, Divider, ErrorBanner, Field, H2, Loader, Muted, Notice, Select } from "../../../components/ui";
import { STR, bnNum, classLevelLabel } from "../../../lib/labels";
import { yearOptionLabel } from "../../../lib/yearHandling";
import { friendlyError } from "../../../lib/errors";
import { useConfirm } from "../../../state/ConfirmContext";
import { space } from "../../../theme/tokens";
import { PlanView } from "./PlanView";

type Shape = SectionCodeT[];
const SHAPES: Array<{ key: string; sections: Shape; label: () => string }> = [
  { key: "main", sections: ["Main"], label: () => STR.ycShapeMain },
  { key: "both", sections: ["Boys", "Girls"], label: () => STR.ycShapeBoth },
  { key: "boys", sections: ["Boys"], label: () => STR.ycShapeBoys },
  { key: "girls", sections: ["Girls"], label: () => STR.ycShapeGirls },
];
const shapeKey = (s: readonly string[]): string => SHAPES.find((x) => x.sections.join() === s.join())?.key ?? "";
export const secLabel = (code: string): string => (code === "Main" ? STR.ycSecMain : code === "Boys" ? STR.ycSecBoys : code === "Girls" ? STR.ycSecGirls : code);

interface ChildDraft {
  decision: DecisionT;
  /** Optional manual section for the new year; absent = automatic. */
  section?: SectionCodeT;
}
interface AdmissionDraft {
  schoolId: string;
  name: string;
  nameBn: string;
  gender: "male" | "female";
  level: number;
  section?: SectionCodeT;
  guardianPhone: string;
}
const COPY_KEYS = ["routine", "bellWindows", "assignmentSchedule", "grants", "mastery"] as const;
type CopyKey = (typeof COPY_KEYS)[number];
const copyLabel = (k: CopyKey): string =>
  ({ routine: STR.ycCopyRoutine, bellWindows: STR.ycCopyBells, assignmentSchedule: STR.ycCopyAssignment, grants: STR.ycCopyGrants, mastery: STR.ycCopyMastery })[k];

const EMPTY_ADMISSION: AdmissionDraft = { schoolId: "", name: "", nameBn: "", gender: "male", level: 1, guardianPhone: "" };

export default function PrepareStep({ canPrepare, onPrepared }: { canPrepare: boolean; onPrepared: (runId: string) => void }): React.ReactElement {
  const client = useClient();
  const { confirmAction } = useConfirm();
  const [picked, setPicked] = useState<{ from?: string; to?: string }>({});
  const [{ data, fetching, error }, refetch] = useQuery({
    query: YEAR_CHANGE_SETUP_QUERY,
    variables: { fromYearId: picked.from ?? null, toYearId: picked.to ?? null },
    requestPolicy: "network-only",
  });
  const [, apply] = useMutation(APPLY_YEAR_CHANGE_PREPARE);
  const setup: YcSetupT | undefined = data?.yearChangeSetup;

  const [shapes, setShapes] = useState<Record<number, Shape>>({});
  const [kids, setKids] = useState<Record<string, ChildDraft>>({});
  const [admissions, setAdmissions] = useState<AdmissionDraft[]>([]);
  const [teachers, setTeachers] = useState<Record<string, string | null>>({});
  const [copy, setCopy] = useState<Record<CopyKey, boolean>>({ routine: true, bellWindows: true, assignmentSchedule: true, grants: true, mastery: true });
  const [draftAdm, setDraftAdm] = useState<AdmissionDraft>(EMPTY_ADMISSION);
  const [admErr, setAdmErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [plan, setPlan] = useState<{ key: string; plan: YcPlanT } | null>(null);
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Re-seed the draft whenever the server hands over a (new) pair of years.
  const seedKey = setup ? `${setup.fromYearId}|${setup.toYearId}` : null;
  useEffect(() => {
    if (!setup) return;
    setShapes(Object.fromEntries(setup.classPlan.map((c) => [c.level, c.sections as Shape])));
    // A prepared run's own choices come back from the server (decisions, admissions, shapes,
    // teachers, copy options) - seeding from the defaults would make the next apply undo it.
    setKids(Object.fromEntries(setup.children.map((c) => [c.studentId, { decision: c.decision, ...(c.toSectionCode ? { section: c.toSectionCode as SectionCodeT } : {}) }])));
    setTeachers(Object.fromEntries(setup.classTeachers.map((t) => [`${t.level}:${t.sectionCode}`, t.teacherId])));
    setAdmissions(
      setup.admissions.map((a) => ({
        schoolId: a.schoolId,
        name: a.name,
        nameBn: a.nameBn ?? "",
        gender: a.gender === "female" ? "female" : "male",
        level: a.level,
        section: a.sectionCode as SectionCodeT,
        guardianPhone: a.guardianPhone,
      })),
    );
    if (setup.copy) setCopy((p) => ({ ...p, ...Object.fromEntries(setup.copy!.filter((f) => (COPY_KEYS as readonly string[]).includes(f.key)).map((f) => [f.key, f.value])) }));
    setPlan(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const shapeOf = useCallback((level: number): Shape => shapes[level] ?? (level >= 3 ? ["Boys", "Girls"] : ["Main"]), [shapes]);

  const input = useMemo<YcPlanInput | null>(() => {
    if (!setup?.fromYearId || !setup.toYearId) return null;
    return {
      fromYearId: setup.fromYearId,
      toYearId: setup.toYearId,
      copy: { ...copy },
      classPlan: Object.entries(shapes).map(([level, sections]) => ({ level: Number(level), sections })),
      promotions: setup.children.map((c) => {
        const d = kids[c.studentId] ?? { decision: c.decision };
        // A manual section only counts while the target class still has it (the shape may have changed).
        const target = d.decision === "PROMOTE" ? c.level + 1 : c.level;
        const keep = d.section && d.decision !== "LEFT" && shapeOf(target).includes(d.section);
        return { studentId: c.studentId, decision: d.decision, ...(keep ? { toSectionCode: d.section } : {}) };
      }),
      admissions: admissions.map((a) => ({
        schoolId: a.schoolId.trim(),
        name: a.name.trim(),
        ...(a.nameBn.trim() ? { nameBn: a.nameBn.trim() } : {}),
        gender: a.gender,
        level: a.level,
        ...(a.section && shapeOf(a.level).includes(a.section) ? { sectionCode: a.section } : {}),
        guardianPhone: a.guardianPhone.trim(),
      })),
      classTeachers: Object.entries(teachers).map(([k, teacherId]) => {
        const [level, sectionCode] = k.split(":");
        return { level: Number(level), sectionCode: sectionCode as SectionCodeT, teacherId };
      }),
    };
  }, [setup, copy, shapes, shapeOf, kids, admissions, teachers]);
  const inputKey = useMemo(() => (input ? JSON.stringify(input) : ""), [input]);
  const planCurrent = !!plan && plan.key === inputKey;

  async function dryRun(): Promise<void> {
    if (!input || busy) return;
    setBusy("plan");
    setErr(null);
    setMsg(null);
    const res = await client.query(YEAR_CHANGE_PLAN_QUERY, { input }, { requestPolicy: "network-only" }).toPromise();
    setBusy(null);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    setPlan({ key: JSON.stringify(input), plan: res.data.yearChangePlan });
  }

  async function onApply(): Promise<void> {
    if (!input || !plan || !planCurrent || busy) return;
    const c = plan.plan.counts;
    const changes = [
      c.admissionsToRemove ? `${bnNum(c.admissionsToRemove)}${STR.ycWillDeleteAdm}` : "",
      c.enrolmentsToRemove ? `${bnNum(c.enrolmentsToRemove)}${STR.ycWillDeleteEnrol}` : "",
      c.enrolmentsToUpdate ? `${bnNum(c.enrolmentsToUpdate)}${STR.ycWillMoveEnrol}` : "",
      c.admissionsToUpdate ? `${bnNum(c.admissionsToUpdate)}${STR.ycWillEditAdm}` : "",
    ].filter(Boolean);
    const ok = await confirmAction({
      title: STR.ycApplyConfirmTitle,
      message: changes.length ? `${STR.ycApplyConfirmMsg}\n\n${STR.ycReconcileTitle}: ${changes.join("; ")}` : STR.ycApplyConfirmMsg,
      confirmLabel: STR.ycApply,
      tone: "danger",
    });
    if (!ok) return;
    setBusy("apply");
    setErr(null);
    const res = await apply({ input });
    setBusy(null);
    if (res.error || !res.data) {
      setErr(friendlyError(res.error));
      return;
    }
    setMsg(STR.ycPrepared);
    setPlan(null);
    onPrepared(res.data.applyYearChangePrepare.runId);
  }

  const setDecision = (id: string, patch: Partial<ChildDraft>): void => setKids((p) => ({ ...p, [id]: { ...(p[id] ?? { decision: "PROMOTE" }), ...patch } }));
  function addAdmission(): void {
    const a = draftAdm;
    if (!a.schoolId.trim() || !a.name.trim() || !a.guardianPhone.trim()) {
      setAdmErr(STR.ycAdmMissing);
      return;
    }
    if (admissions.some((x) => x.schoolId.trim() === a.schoolId.trim())) {
      setAdmErr(STR.ycAdmDup);
      return;
    }
    setAdmErr(null);
    setAdmissions((p) => [...p, a]);
    setDraftAdm({ ...EMPTY_ADMISSION, level: a.level });
  }

  if (fetching && !setup) return <Loader label={STR.loading} />;
  if (error) return <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />;
  if (!setup) return <Muted>{STR.ycNoSetup}</Muted>;

  const levels = [...new Set(setup.children.map((c) => c.level))].sort((a, b) => a - b);
  const allLevels = setup.classPlan.map((c) => c.level);
  const currentLabel = setup.years.find((y) => y.current)?.label ?? null;
  const yearOptions = setup.years.map((y) => ({ label: yearOptionLabel(y, currentLabel), value: y.id }));

  return (
    <View style={{ gap: space(3) }}>
      <Notice message={STR.ycPrepareHint} tone="info" />
      {setup.preparedRunId ? <Notice message={`${STR.ycPreparedLoaded} (${setup.preparedRunId})`} tone="warn" /> : null}
      {err ? <Notice message={err} tone="danger" /> : null}
      {msg ? <Notice message={msg} tone="ok" /> : null}

      <H2>{STR.ycYears}</H2>
      <Select label={STR.ycFromYear} value={setup.fromYearId} options={yearOptions} onChange={(v) => setPicked((p) => ({ ...p, from: v }))} />
      <Select label={STR.ycToYear} value={setup.toYearId} options={yearOptions} onChange={(v) => setPicked((p) => ({ ...p, to: v }))} />
      {!setup.toYearId ? <Notice message={STR.ycNoToYear} tone="warn" /> : null}

      <Divider />
      <H2>{STR.ycClassesTitle}</H2>
      <Muted>{STR.ycClassesHint}</Muted>
      {setup.classPlan.map((c) => (
        <Card key={c.level}>
          <Body style={{ fontWeight: "700" }}>{classLevelLabel(c.level)}</Body>
          <ChipRow>
            {SHAPES.map((s) => (
              <Chip key={s.key} label={s.label()} selected={shapeKey(shapeOf(c.level)) === s.key} onPress={() => setShapes((p) => ({ ...p, [c.level]: s.sections }))} />
            ))}
          </ChipRow>
        </Card>
      ))}

      <Divider />
      <H2>{STR.ycPromoTitle}</H2>
      <Muted>{STR.ycPromoHint}</Muted>
      {levels.map((level) => {
        const list = setup.children.filter((c) => c.level === level);
        const count = (d: DecisionT): number => list.filter((c) => (kids[c.studentId]?.decision ?? c.decision) === d).length;
        return (
          <Card key={level}>
            <View style={{ gap: space(1) }}>
              <Body style={{ fontWeight: "700" }} numberOfLines={2}>
                {classLevelLabel(level)} — {bnNum(list.length)} {STR.ycChildrenWord}
              </Body>
              <Muted>
                {STR.ycPromote} {bnNum(count("PROMOTE"))} · {STR.ycRepeat} {bnNum(count("REPEAT"))} · {STR.ycLeft} {bnNum(count("LEFT"))}
              </Muted>
              <Button title={open[level] ? STR.ycHideList : STR.ycShowList} variant="ghost" onPress={() => setOpen((p) => ({ ...p, [level]: !p[level] }))} />
            </View>
            {open[level]
              ? list.map((c) => {
                  const d = kids[c.studentId] ?? { decision: c.decision };
                  const target = d.decision === "PROMOTE" ? level + 1 : level;
                  const targetShape = d.decision === "LEFT" ? [] : shapeOf(target);
                  return (
                    <View key={c.studentId} style={{ marginTop: space(2), gap: space(1) }}>
                      <Body style={{ fontWeight: "600" }}>
                        {c.schoolId} · {c.name}
                      </Body>
                      <ChipRow>
                        <Chip label={STR.ycPromote} selected={d.decision === "PROMOTE"} onPress={() => setDecision(c.studentId, { decision: d.decision === "PROMOTE" ? "REPEAT" : "PROMOTE", section: undefined })} />
                        <Chip label={STR.ycRepeat} selected={d.decision === "REPEAT"} onPress={() => setDecision(c.studentId, { decision: "REPEAT", section: undefined })} />
                        <Chip label={STR.ycLeftChip} selected={d.decision === "LEFT"} onPress={() => setDecision(c.studentId, { decision: d.decision === "LEFT" ? "PROMOTE" : "LEFT", section: undefined })} />
                      </ChipRow>
                      {targetShape.length > 1 ? (
                        <ChipRow>
                          <Chip label={STR.ycSecAuto} selected={!d.section} onPress={() => setDecision(c.studentId, { section: undefined })} />
                          {targetShape.map((code) => (
                            <Chip key={code} label={secLabel(code)} selected={d.section === code} onPress={() => setDecision(c.studentId, { section: code })} />
                          ))}
                        </ChipRow>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </Card>
        );
      })}

      <Divider />
      <H2>{STR.ycAdmTitle}</H2>
      <Muted>{STR.ycAdmHint}</Muted>
      {admissions.map((a, i) => (
        <Card key={a.schoolId}>
          <Body style={{ fontWeight: "600" }}>
            {a.schoolId} · {a.name}
          </Body>
          <Muted>
            {classLevelLabel(a.level)}
            {a.section ? ` · ${secLabel(a.section)}` : ""} · {a.guardianPhone}
          </Muted>
          <Button title={STR.ycRemove} variant="ghost" onPress={() => setAdmissions((p) => p.filter((_, j) => j !== i))} />
        </Card>
      ))}
      <Card>
        <Field label={STR.ycAdmSchoolId} value={draftAdm.schoolId} onChangeText={(v) => setDraftAdm((p) => ({ ...p, schoolId: v }))} />
        <Field label={STR.ycAdmName} value={draftAdm.name} onChangeText={(v) => setDraftAdm((p) => ({ ...p, name: v }))} autoCapitalize="words" />
        <Field label={STR.ycAdmNameBn} value={draftAdm.nameBn} onChangeText={(v) => setDraftAdm((p) => ({ ...p, nameBn: v }))} />
        <ChipRow>
          <Chip label={STR.ycBoy} selected={draftAdm.gender === "male"} onPress={() => setDraftAdm((p) => ({ ...p, gender: "male" }))} />
          <Chip label={STR.ycGirl} selected={draftAdm.gender === "female"} onPress={() => setDraftAdm((p) => ({ ...p, gender: "female" }))} />
        </ChipRow>
        <Select
          label={STR.ycAdmClass}
          value={String(draftAdm.level)}
          options={allLevels.map((l) => ({ label: classLevelLabel(l), value: String(l) }))}
          onChange={(v) => setDraftAdm((p) => ({ ...p, level: Number(v), section: undefined }))}
        />
        {shapeOf(draftAdm.level).length > 1 ? (
          <ChipRow>
            <Chip label={STR.ycSecAuto} selected={!draftAdm.section} onPress={() => setDraftAdm((p) => ({ ...p, section: undefined }))} />
            {shapeOf(draftAdm.level).map((code) => (
              <Chip key={code} label={secLabel(code)} selected={draftAdm.section === code} onPress={() => setDraftAdm((p) => ({ ...p, section: code }))} />
            ))}
          </ChipRow>
        ) : null}
        <Field label={STR.ycAdmPhone} value={draftAdm.guardianPhone} onChangeText={(v) => setDraftAdm((p) => ({ ...p, guardianPhone: v }))} keyboardType="phone-pad" />
        {admErr ? <Notice message={admErr} tone="danger" /> : null}
        <Button title={STR.ycAdmAdd} variant="secondary" onPress={addAdmission} />
      </Card>

      <Divider />
      <H2>{STR.ycTeachersTitle}</H2>
      <Muted>{STR.ycTeachersHint}</Muted>
      {setup.classPlan.map((c) =>
        shapeOf(c.level).map((code) => {
          const key = `${c.level}:${code}`;
          return (
            <Card key={key}>
              <Select
                label={`${classLevelLabel(c.level)} · ${secLabel(code)}`}
                value={teachers[key] ?? null}
                searchable
                options={setup.teachers.map((t) => ({ label: t.name, value: t.id }))}
                onChange={(v) => setTeachers((p) => ({ ...p, [key]: v }))}
                placeholder={STR.ycNoTeacher}
              />
              {teachers[key] ? <Button title={STR.ycClear} variant="ghost" onPress={() => setTeachers((p) => ({ ...p, [key]: null }))} /> : null}
            </Card>
          );
        }),
      )}

      <Divider />
      <H2>{STR.ycCopyTitle}</H2>
      <Muted>{STR.ycCopyHint}</Muted>
      <ChipRow>
        {COPY_KEYS.map((k) => (
          <Chip key={k} label={copyLabel(k)} selected={copy[k]} onPress={() => setCopy((p) => ({ ...p, [k]: !p[k] }))} />
        ))}
      </ChipRow>

      <Divider />
      <Button title={STR.ycDryRun} onPress={dryRun} loading={busy === "plan"} disabled={!input || !setup.toYearId || !!busy} />
      {plan ? (
        <>
          {!planCurrent ? <Notice message={STR.ycPlanStale} tone="warn" /> : null}
          <PlanView plan={plan.plan} />
        </>
      ) : null}
      {canPrepare ? (
        <Button
          title={STR.ycApply}
          onPress={onApply}
          loading={busy === "apply"}
          disabled={!plan || !planCurrent || plan.plan.refusals.length > 0 || !!busy}
        />
      ) : null}
      {plan && planCurrent && plan.plan.refusals.length > 0 ? <Notice message={STR.ycBlocked} tone="danger" /> : null}
    </View>
  );
}
