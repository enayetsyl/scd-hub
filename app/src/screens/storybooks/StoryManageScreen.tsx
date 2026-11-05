/**
 * StoryManageScreen (SB-1, W12) — Office's "Series, tags & ages" (library:edit).
 *
 *  - সিরিজ: every series (draft / published / hidden) → open it; add a new series
 *    (code, names, band). Books are uploaded and published on the series screen.
 *  - ট্যাগ: the managed tag list — add, rename, retire, merge one tag into another.
 *  - বয়সের দল: which classes' guardians see each band; add a band. Bands only filter
 *    what guardians browse — the desk can lend any book to any child (D-#981).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ROSTER_CLASS_LEVELS } from "@scd/shared";
import {
  CREATE_STORY_SERIES,
  CREATE_STORY_TAG,
  MERGE_STORY_TAGS,
  SAVE_STORY_AGE_BAND,
  STORY_AGE_BANDS_QUERY,
  STORY_SHELF_QUERY,
  STORY_TAGS_QUERY,
  UPDATE_STORY_TAG,
  LIBRARY_HOLIDAY_RULES,
  SAVE_LIBRARY_HOLIDAY_RULE,
  type LibraryHolidayRuleT,
  type StoryAgeBandT,
  type StoryTagT,
} from "../../graphql/storybooks";
import { Badge, Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { LIBRARY_POLICIES_QUERY, UPSERT_LIBRARY_POLICY } from "../../graphql/operations";
import type { StorybooksStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<StorybooksStackParamList, "StoryManage">;
type Msg = { tone: "ok" | "danger"; text: string } | null;
type Tab = "series" | "tags" | "bands" | "rules";

function SeriesTab({ onOpen, setMsg }: { onOpen: (id: string, name: string) => void; setMsg: (m: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: STORY_SHELF_QUERY, variables: { studentId: null } });
  const [bandsQ] = useQuery({ query: STORY_AGE_BANDS_QUERY });
  const [{ fetching }, create] = useMutation(CREATE_STORY_SERIES);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [band, setBand] = useState("3-6");

  const add = async (): Promise<void> => {
    const res = await create({ code: code.trim().toUpperCase(), nameBn, nameEn: nameEn || null, ageBandCode: band });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setAdding(false);
    setCode("");
    setNameBn("");
    setNameEn("");
    setMsg({ tone: "ok", text: STR.stbSaved });
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <View>
      <Button title={adding ? STR.stbCancel : STR.stbAddSeries} variant={adding ? "ghost" : "secondary"} onPress={() => setAdding((a) => !a)} style={{ marginBottom: space(3) }} />
      {adding ? (
        <Card style={{ marginBottom: space(3) }}>
          <Field label={STR.stbSeriesCode} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
          <Field label={STR.stbNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
          <Field label={STR.stbNameEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
          <Muted>{STR.stbBand}</Muted>
          <ChipRow>
            {(bandsQ.data?.storyAgeBands ?? []).map((b) => (
              <Chip key={b.code} label={b.labelBn} selected={band === b.code} onPress={() => setBand(b.code)} />
            ))}
          </ChipRow>
          <Button title={STR.stbCreate} loading={fetching} onPress={() => void add()} />
        </Card>
      ) : null}
      <QueryGate results={[q]} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
        {(q.data?.storyShelf ?? []).map((s) => (
          <Pressable
            key={s.id}
            onPress={() => onOpen(s.id, s.nameBn)}
            accessibilityRole="button"
            style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: space(2) }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{s.nameBn}</Text>
              <Muted style={{ fontSize: 12 }}>
                {s.code} · {STR.stbSeriesMeta.replace("{n}", bnNum(s.bookCount)).replace("{band}", s.ageBandLabel)} · {STR.stbCopiesCount.replace("{n}", bnNum(s.copyCount))}
              </Muted>
            </View>
            {s.draftBooks > 0 ? <Badge text={STR.stbDraftsCount.replace("{n}", bnNum(s.draftBooks))} tone="info" /> : null}
            <Badge text={s.status === "PUBLISHED" ? STR.stbPublished : s.status === "HIDDEN" ? STR.stbHidden : STR.stbDraft} tone={s.status === "PUBLISHED" ? "ok" : "warn"} />
          </Pressable>
        ))}
      </QueryGate>
    </View>
  );
}

function TagRow({ tag, all, onChanged }: { tag: StoryTagT; all: StoryTagT[]; onChanged: (m: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const [mode, setMode] = useState<"view" | "rename" | "merge">("view");
  const [nameBn, setNameBn] = useState(tag.nameBn);
  const [nameEn, setNameEn] = useState(tag.nameEn ?? "");
  const [{ fetching }, update] = useMutation(UPDATE_STORY_TAG);
  const [, merge] = useMutation(MERGE_STORY_TAGS);
  const done = (err: unknown, ok: string): void => {
    if (err) return onChanged({ tone: "danger", text: friendlyError(err as never) });
    setMode("view");
    onChanged({ tone: "ok", text: ok });
  };
  return (
    <View style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{tag.nameBn}</Text>
          {tag.nameEn ? <Muted style={{ fontSize: 12 }}>{tag.nameEn}</Muted> : null}
        </View>
        {!tag.active ? <Badge text={STR.stbRetired} tone="muted" /> : null}
        {tag.active ? <Button title={STR.stbRename} variant="ghost" onPress={() => setMode(mode === "rename" ? "view" : "rename")} /> : null}
        {tag.active ? <Button title={STR.stbMerge} variant="ghost" onPress={() => setMode(mode === "merge" ? "view" : "merge")} /> : null}
        <Button
          title={tag.active ? STR.stbRetire : STR.stbRestore}
          variant="ghost"
          loading={fetching}
          onPress={() => void update({ tagId: tag.id, active: !tag.active }).then((r) => done(r.error, STR.stbSaved))}
        />
      </View>
      {mode === "rename" ? (
        <View style={{ marginTop: space(2) }}>
          <Field label={STR.stbNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
          <Field label={STR.stbNameEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
          <Button title={STR.stbSave} loading={fetching} onPress={() => void update({ tagId: tag.id, nameBn, nameEn }).then((r) => done(r.error, STR.stbSaved))} />
        </View>
      ) : null}
      {mode === "merge" ? (
        <View style={{ marginTop: space(2) }}>
          <Muted>{STR.stbMergePick.replace("{name}", tag.nameBn)}</Muted>
          <ChipRow>
            {all
              .filter((t) => t.active && t.id !== tag.id)
              .map((t) => (
                <Chip key={t.id} label={t.nameBn} onPress={() => void merge({ fromTagId: tag.id, intoTagId: t.id }).then((r) => done(r.error, STR.stbMergeDone))} />
              ))}
          </ChipRow>
        </View>
      ) : null}
    </View>
  );
}

function TagsTab({ setMsg }: { setMsg: (m: Msg) => void }): React.ReactElement {
  const [q, refetch] = useQuery({ query: STORY_TAGS_QUERY, variables: { includeInactive: true } });
  const [{ fetching }, create] = useMutation(CREATE_STORY_TAG);
  const [nameBn, setNameBn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const tags = q.data?.storyTags ?? [];
  const add = async (): Promise<void> => {
    if (!nameBn.trim()) return setMsg({ tone: "danger", text: STR.stbNeedNameBn });
    const res = await create({ nameBn, nameEn: nameEn || null });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setNameBn("");
    setNameEn("");
    reload();
  };
  return (
    <View>
      <Card style={{ marginBottom: space(3) }}>
        <Field label={STR.stbNewTag} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
        <Field label={STR.stbNewTagEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
        <Button title={STR.stbCreate} loading={fetching} onPress={() => void add()} />
      </Card>
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {tags.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            all={tags}
            onChanged={(m) => {
              setMsg(m);
              reload();
            }}
          />
        ))}
      </QueryGate>
    </View>
  );
}

function BandCard({ band, onSaved }: { band: StoryAgeBandT | null; onSaved: (m: Msg) => void }): React.ReactElement {
  const [{ fetching }, save] = useMutation(SAVE_STORY_AGE_BAND);
  const [code, setCode] = useState(band?.code ?? "");
  const [labelBn, setLabelBn] = useState(band?.labelBn ?? "");
  const [ageMin, setAgeMin] = useState(band ? String(band.ageMin) : "");
  const [ageMax, setAgeMax] = useState(band ? String(band.ageMax) : "");
  const [levels, setLevels] = useState<number[]>(band?.classLevels ?? []);
  const submit = async (): Promise<void> => {
    const res = await save({ code: code.trim(), labelBn, ageMin: Number(ageMin), ageMax: Number(ageMax), classLevels: levels });
    onSaved(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbSaved });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      {band ? (
        <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", marginBottom: space(2) }}>
          <Body style={{ fontWeight: "700", flex: 1 }}>{band.labelBn}</Body>
          {band.isDefault ? <Badge text={STR.stbBandDefault} tone="muted" /> : null}
        </View>
      ) : (
        <Field label={STR.stbBandCode} value={code} onChangeText={setCode} />
      )}
      <Field label={STR.stbBandLabel} value={labelBn} onChangeText={setLabelBn} />
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <Field label={STR.stbAgeMin} value={ageMin} onChangeText={setAgeMin} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={STR.stbAgeMax} value={ageMax} onChangeText={setAgeMax} keyboardType="number-pad" />
        </View>
      </View>
      <Muted>{STR.stbBandClasses}</Muted>
      <ChipRow>
        {ROSTER_CLASS_LEVELS.map((l) => (
          <Chip
            key={l}
            label={classLevelLabel(l)}
            selected={levels.includes(l)}
            onPress={() => setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]))}
          />
        ))}
      </ChipRow>
      <Button title={STR.stbSave} loading={fetching} onPress={() => void submit()} />
    </Card>
  );
}

function BandsTab({ setMsg }: { setMsg: (m: Msg) => void }): React.ReactElement {
  const [q, refetch] = useQuery({ query: STORY_AGE_BANDS_QUERY });
  const [adding, setAdding] = useState(false);
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const saved = (m: Msg): void => {
    setMsg(m);
    if (m?.tone === "ok") setAdding(false);
    reload();
  };
  return (
    <View>
      <Notice tone="info" message={STR.stbBandHint} />
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {(q.data?.storyAgeBands ?? []).map((b) => (
          <BandCard key={`${b.code}-${b.isDefault}`} band={b} onSaved={saved} />
        ))}
      </QueryGate>
      {adding ? <BandCard band={null} onSaved={saved} /> : <Button title={STR.stbAddBand} variant="secondary" onPress={() => setAdding(true)} />}
    </View>
  );
}

/** SB-2 (W8): the usual student rule (LibraryPolicy STUDENT) and dated holiday rules. */
function StudentPolicyCard({ setMsg }: { setMsg: (m: Msg) => void }): React.ReactElement {
  const [q] = useQuery({ query: LIBRARY_POLICIES_QUERY });
  const p = q.data?.libraryPolicies.find((x) => x.borrowerType === "STUDENT");
  const [{ fetching }, upsert] = useMutation(UPSERT_LIBRARY_POLICY);
  const [vals, setVals] = useState<Record<string, string> | null>(null);
  const v = vals ?? (p ? { max: String(p.maxConcurrent), days: String(p.loanDays), renew: String(p.maxRenewals), hold: String(p.holdDays) } : null);
  if (!v) return <Muted>{STR.loading}</Muted>;
  const set = (k: string) => (t: string) => setVals({ ...v, [k]: t });
  const save = async (): Promise<void> => {
    const res = await upsert({ borrowerType: "STUDENT", maxConcurrent: Number(v.max), loanDays: Number(v.days), maxRenewals: Number(v.renew), holdDays: Number(v.hold) });
    setMsg(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbSaved });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.stbRulesStudent}</Body>
      <Field label={STR.stbRuleMax} value={v.max} onChangeText={set("max")} keyboardType="number-pad" />
      <Field label={STR.stbRuleDays} value={v.days} onChangeText={set("days")} keyboardType="number-pad" />
      <Field label={STR.stbRuleRenew} value={v.renew} onChangeText={set("renew")} keyboardType="number-pad" />
      <Field label={STR.stbRuleHold} value={v.hold} onChangeText={set("hold")} keyboardType="number-pad" />
      <Button title={STR.stbSave} loading={fetching} onPress={() => void save()} />
    </Card>
  );
}

function HolidayForm({ rule, onSaved }: { rule: LibraryHolidayRuleT | null; onSaved: (m: Msg) => void }): React.ReactElement {
  const [{ fetching }, save] = useMutation(SAVE_LIBRARY_HOLIDAY_RULE);
  const [nameBn, setName] = useState(rule?.nameBn ?? "");
  const [fromDay, setFrom] = useState(rule?.fromDay ?? "");
  const [toDay, setTo] = useState(rule?.toDay ?? "");
  const [dueDay, setDue] = useState(rule?.dueDay ?? "");
  const [max, setMax] = useState(rule ? String(rule.maxConcurrent) : "4");
  const submit = async (active?: boolean): Promise<void> => {
    const res = await save({ ruleId: rule?.id ?? null, nameBn, fromDay: fromDay.trim(), toDay: toDay.trim(), dueDay: dueDay.trim(), maxConcurrent: Number(max), active: active ?? null });
    onSaved(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.stbSaved });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Field label={STR.stbRuleName} value={nameBn} onChangeText={setName} autoCapitalize="sentences" />
      <Field label={STR.stbRuleFrom} value={fromDay} onChangeText={setFrom} placeholder="2026-12-20" />
      <Field label={STR.stbRuleTo} value={toDay} onChangeText={setTo} placeholder="2026-12-31" />
      <Field label={STR.stbRuleDue} value={dueDay} onChangeText={setDue} placeholder="2027-01-01" />
      <Field label={STR.stbRuleMax} value={max} onChangeText={setMax} keyboardType="number-pad" />
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Button title={STR.stbSave} loading={fetching} onPress={() => void submit()} />
        {rule?.active ? <Button title={STR.stbRetire} variant="ghost" onPress={() => void submit(false)} /> : null}
      </View>
    </Card>
  );
}

function RulesTab({ setMsg }: { setMsg: (m: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: LIBRARY_HOLIDAY_RULES, variables: { includeInactive: true } });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const saved = (m: Msg): void => {
    setMsg(m);
    if (m?.tone === "ok") setEditing(null);
    refetch({ requestPolicy: "network-only" });
  };
  return (
    <View>
      <StudentPolicyCard setMsg={setMsg} />
      <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.stbRulesHoliday}</Body>
      <Muted style={{ marginBottom: space(2) }}>{STR.stbRulesHint}</Muted>
      {(q.data?.libraryHolidayRules ?? []).map((r) =>
        editing === r.id ? (
          <HolidayForm key={r.id} rule={r} onSaved={saved} />
        ) : (
          <Pressable
            key={r.id}
            onPress={() => setEditing(r.id)}
            accessibilityRole="button"
            style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", gap: space(2), alignItems: "center" }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{r.nameBn}</Text>
              <Muted style={{ fontSize: 12 }}>
                {STR.stbRuleLine.replace("{from}", r.fromDay).replace("{to}", r.toDay).replace("{n}", bnNum(r.maxConcurrent)).replace("{due}", r.dueDay)}
              </Muted>
            </View>
            {!r.active ? <Badge text={STR.stbRetired} tone="muted" /> : null}
          </Pressable>
        ),
      )}
      {editing === "new" ? <HolidayForm rule={null} onSaved={saved} /> : <Button title={STR.stbRuleAdd} variant="secondary" onPress={() => setEditing("new")} style={{ marginTop: space(3) }} />}
    </View>
  );
}

export default function StoryManageScreen({ navigation }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>("series");
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <ChipRow>
          <Chip label={STR.stbTabSeries} selected={tab === "series"} onPress={() => setTab("series")} />
          <Chip label={STR.stbTabTags} selected={tab === "tags"} onPress={() => setTab("tags")} />
          <Chip label={STR.stbTabBands} selected={tab === "bands"} onPress={() => setTab("bands")} />
          <Chip label={STR.stbTabRules} selected={tab === "rules"} onPress={() => setTab("rules")} />
        </ChipRow>
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        {tab === "series" ? <SeriesTab setMsg={setMsg} onOpen={(seriesId, title) => navigation.navigate("StorySeries", { seriesId, title })} /> : null}
        {tab === "tags" ? <TagsTab setMsg={setMsg} /> : null}
        {tab === "bands" ? <BandsTab setMsg={setMsg} /> : null}
        {tab === "rules" ? <RulesTab setMsg={setMsg} /> : null}
      </ScrollView>
    </Screen>
  );
}
