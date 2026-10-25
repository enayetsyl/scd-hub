/**
 * PermissionMatrix (PM, docs/prd-permission-matrix.md §7, D-#800) — every feature × every
 * action, one switch per action, driven by FEATURE_CATALOGUE. One grid, two hosts: the
 * Roles view (Teacher / Office template) and the per-person editor. A feature added to the
 * catalogue appears here with no change to this file (J-PM3).
 *
 * The host decides what "on" means and what a tap does; this component only lays the
 * catalogue out: editor group → collapsible feature card ("7 / 9 on", all on / all off)
 * → action rows (Bangla name, English name, one-line description, badges). LOCKED rows
 * show a lock, SELF rows "everyone, for themselves", ESCALATION rows stay off until
 * their safety check ships; a designation is shown as "also needs: …".
 */
import React from "react";
import { View, Pressable } from "react-native";
import {
  FEATURE_CATALOGUE,
  FEATURE_GROUPS,
  type CatalogueAction,
  type CataloguePermission,
  type FeatureGroup,
  type FeatureKey,
} from "@scd/shared";
import { Body, Muted, Card, Chip, ChipRow, Badge, Field } from "./ui";
import { STR, getActiveLang } from "../lib/labels";
import { space } from "../theme/tokens";

export type MatrixBadge = { text: string; tone: "muted" | "ok" | "warn" | "info" };

export interface PermissionMatrixProps {
  isOn: (perm: CataloguePermission) => boolean;
  /** Provenance / change badge for a row, if any. */
  badge?: (perm: CataloguePermission) => MatrixBadge | null;
  /** Escalation actions stay off until their target guards ship (server mirrors this). */
  escalationReady?: boolean;
  /** The row whose mutation is in flight (its switch is disabled meanwhile). */
  busy?: string | null;
  /** Awaited one at a time by "all on / all off". */
  onToggle: (perm: CataloguePermission, next: boolean) => void | Promise<void>;
}

const GROUP_BN: Record<FeatureGroup, string> = {
  teaching_and_trackers: "পাঠদান ও ট্র্যাকার",
  assessment_and_exams: "মূল্যায়ন ও পরীক্ষা",
  students_and_families: "শিক্ষার্থী ও পরিবার",
  attendance_and_routine: "উপস্থিতি ও রুটিন",
  staff_and_hr: "স্টাফ ও এইচআর",
  finance: "হিসাব",
  content_and_books: "কনটেন্ট ও বই",
  communication: "যোগাযোগ",
  school_operations: "স্কুল পরিচালনা",
  reports: "রিপোর্ট",
  admin_and_access: "অ্যাডমিন ও অনুমতি",
};
const GROUP_EN: Record<FeatureGroup, string> = {
  teaching_and_trackers: "Teaching & trackers",
  assessment_and_exams: "Assessment & exams",
  students_and_families: "Students & families",
  attendance_and_routine: "Attendance & routine",
  staff_and_hr: "Staff & HR",
  finance: "Finance",
  content_and_books: "Content & books",
  communication: "Communication",
  school_operations: "School operations",
  reports: "Reports",
  admin_and_access: "Admin & access",
};

const DESIGNATION: Record<string, { bn: string; en: string }> = {
  class_teacher: { bn: "শ্রেণি শিক্ষক", en: "class teacher" },
  homework_confirmer: { bn: "বাড়ির কাজ নিশ্চিতকারী", en: "homework confirmer" },
  homework_supervisor: { bn: "বাড়ির কাজের তত্ত্বাবধায়ক", en: "homework supervisor" },
  whole_section_supervisor: { bn: "পুরো শাখার তত্ত্বাবধায়ক", en: "whole-section supervisor" },
  librarian: { bn: "লাইব্রেরিয়ান", en: "librarian" },
  marker_of_the_day: { bn: "দিনের উপস্থিতি গ্রহণকারী", en: "attendance marker of the day" },
  assigned_observer: { bn: "নির্ধারিত পর্যবেক্ষক", en: "assigned observer" },
  assigned_reviewer: { bn: "নির্ধারিত রিভিউয়ার", en: "assigned reviewer" },
  vocab_tester: { bn: "ভোকাবুলারি পরীক্ষক", en: "vocab tester" },
  group_lead: { bn: "গ্রুপ শিক্ষক", en: "group lead" },
  digest_recipient: { bn: "সারসংক্ষেপ প্রাপক", en: "digest recipient" },
  row_teacher: { bn: "নিজের সারির শিক্ষক", en: "the row's teacher" },
  slot_teacher_or_cover: { bn: "পিরিয়ডের শিক্ষক বা বদলি", en: "the period's teacher or cover" },
};

function designationLabel(d: string): string {
  const en = getActiveLang() === "en";
  return d
    .split("/")
    .map((k) => (DESIGNATION[k] ? (en ? DESIGNATION[k].en : DESIGNATION[k].bn) : k))
    .join(en ? " / " : " / ");
}

type Row = { perm: CataloguePermission; action: CatalogueAction };
type FeatureBlock = { key: FeatureKey; bn: string; en: string; rows: Row[] };

const BY_GROUP: { group: FeatureGroup; features: FeatureBlock[] }[] = FEATURE_GROUPS.map((group) => ({
  group,
  features: (Object.keys(FEATURE_CATALOGUE) as FeatureKey[])
    .filter((k) => FEATURE_CATALOGUE[k].group === group)
    .map((k) => {
      const f = FEATURE_CATALOGUE[k];
      const actions = f.actions as Record<string, CatalogueAction>;
      return {
        key: k,
        bn: f.bn,
        en: f.en,
        rows: Object.keys(actions).map((a) => ({ perm: `${k}:${a}` as CataloguePermission, action: actions[a] })),
      };
    }),
}));

export function switchable(action: CatalogueAction, escalationReady: boolean): boolean {
  if (action.flags.includes("LOCKED") || action.flags.includes("SELF")) return false;
  if (action.flags.includes("ESCALATION") && !escalationReady) return false;
  return true;
}

export default function PermissionMatrix({
  isOn,
  badge,
  escalationReady = false,
  busy,
  onToggle,
}: PermissionMatrixProps): React.ReactElement {
  const en = getActiveLang() === "en";
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();

  async function runAll(list: Row[], next: boolean): Promise<void> {
    for (const r of list) await onToggle(r.perm, next);
  }

  const matches = (f: FeatureBlock, r: Row): boolean =>
    !q ||
    f.bn.toLowerCase().includes(q) ||
    f.en.toLowerCase().includes(q) ||
    r.action.bn.toLowerCase().includes(q) ||
    r.action.en.toLowerCase().includes(q) ||
    r.perm.includes(q);

  return (
    <View>
      <Field value={query} onChangeText={setQuery} placeholder={STR.acSearch} />
      {BY_GROUP.map(({ group, features }) => {
        const shown = features
          .map((f) => ({ f, rows: f.rows.filter((r) => matches(f, r)) }))
          .filter((x) => x.rows.length > 0);
        if (shown.length === 0) return null;
        return (
          <View key={group} style={{ marginTop: space(3) }}>
            <Body style={{ fontWeight: "700", fontSize: 16, marginBottom: space(1) }}>
              {en ? GROUP_EN[group] : GROUP_BN[group]}
            </Body>
            {shown.map(({ f, rows }) => {
              const onCount = f.rows.filter((r) => isOn(r.perm)).length;
              const expanded = !!q || !!open[f.key];
              const toggleable = rows.filter((r) => switchable(r.action, escalationReady));
              return (
                <Card key={f.key}>
                  <Pressable
                    onPress={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))}
                    style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}
                  >
                    <Body style={{ fontWeight: "700", width: 18 }}>{expanded ? "▾" : "▸"}</Body>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontWeight: "700" }}>{en ? f.en : f.bn}</Body>
                      <Muted>{en ? f.bn : f.en}</Muted>
                    </View>
                    <Badge
                      text={STR.acCountOn.replace("{on}", String(onCount)).replace("{all}", String(f.rows.length))}
                      tone={onCount === 0 ? "muted" : onCount === f.rows.length ? "ok" : "info"}
                    />
                  </Pressable>
                  {expanded ? (
                    <View style={{ marginTop: space(2) }}>
                      {toggleable.length > 1 ? (
                        <ChipRow>
                          <Chip
                            label={STR.acAllOn}
                            onPress={() => void runAll(toggleable.filter((r) => !isOn(r.perm)), true)}
                          />
                          <Chip
                            label={STR.acAllOff}
                            onPress={() => void runAll(toggleable.filter((r) => isOn(r.perm)), false)}
                          />
                        </ChipRow>
                      ) : null}
                      {(() => {
                        // Reach hint (owner 2026-10-25): an action switched on for someone who
                        // teaches no class here (e.g. an Office person given "declare") only works
                        // where they have a teaching grant — unless the feature's "every section"
                        // switch is on too. Name that switch so the Principal can find it.
                        const reach = f.rows.find((r) => r.perm.endsWith(":edit_all")) ?? f.rows.find((r) => r.perm.endsWith(":view_all"));
                        if (!reach || f.rows.length < 2) return null;
                        return (
                          <Muted style={{ marginTop: space(1) }}>
                            {STR.acReachHint.replace("{reach}", en ? reach.action.en : reach.action.bn)}
                          </Muted>
                        );
                      })()}
                      {rows.map((r) => {
                        const on = isOn(r.perm);
                        const flags = r.action.flags;
                        const canSwitch = switchable(r.action, escalationReady);
                        const b = badge?.(r.perm) ?? null;
                        let note: string | null = null;
                        if (flags.includes("LOCKED")) note = STR.acLockedRow;
                        else if (flags.includes("SELF")) note = STR.acSelfRow;
                        else if (flags.includes("ESCALATION") && !escalationReady) note = STR.acEscalationRow;
                        return (
                          <View
                            key={r.perm}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: space(2),
                              paddingVertical: space(1.5),
                              borderTopWidth: 1,
                              borderTopColor: "rgba(127,127,127,0.18)",
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Body style={{ fontWeight: "600" }}>{en ? r.action.en : r.action.bn}</Body>
                              <Muted>{en ? r.action.bn : r.action.en} · {r.action.desc}</Muted>
                              {r.action.designation ? (
                                <Muted style={{ marginTop: 2 }}>
                                  {STR.acNeeds} {designationLabel(r.action.designation)}
                                </Muted>
                              ) : null}
                              {note ? <Muted style={{ marginTop: 2 }}>{note}</Muted> : null}
                            </View>
                            {b ? <Badge text={b.text} tone={b.tone} /> : null}
                            {canSwitch ? (
                              <Chip
                                label={busy === r.perm ? "…" : on ? STR.acOn : STR.acOff}
                                selected={on}
                                onPress={() => {
                                  if (busy !== r.perm) onToggle(r.perm, !on);
                                }}
                              />
                            ) : (
                              <Badge text={flags.includes("LOCKED") ? "🔒" : on ? STR.acOn : STR.acOff} tone="muted" />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
