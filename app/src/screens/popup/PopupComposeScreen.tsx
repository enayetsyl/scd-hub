/**
 * Compose a pop-up notice (D-#852–#857, docs/prd-popup-notice.md) — five steps:
 *
 *   ১ প্রাপক   who: staff filters, guardian filters, hand-picked people (the custom list,
 *              D-#854) and saved lists; a live count + name list from the server, with the
 *              guardians who cannot see a pop-up (no login) counted out loud
 *   ২ বার্তা   title / body (+ merge fields {নাম} {সন্তান} {শ্রেণি} for a tailored message),
 *              tone, optional English, optional attachment link
 *   ৩ আচরণ    presets (quick / read to the end / read for N seconds / answer required) and
 *              the switches behind them, mirrored from the server's checks
 *   ৪ সময়      start now or later, end date, how often
 *   ৫ পাঠান    review, preview on this device, send to me first, save, send
 *
 * A notice already sent opens in LIVE-EDIT mode: only the words, the end date and the
 * button labels change (the audience and the rules are locked once people have seen it).
 * The server re-checks every rule and permission; this screen only helps get it right.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  DELETE_POPUP_AUDIENCE_LIST,
  DELETE_POPUP_DRAFT,
  EDIT_LIVE_POPUP_NOTICE,
  POPUP_AUDIENCE_LISTS_PAGE,
  POPUP_AUDIENCE_PREVIEW,
  POPUP_NOTICE,
  POPUP_PICKED_PEOPLE,
  PUBLISH_POPUP_NOTICE,
  SAVE_POPUP_AUDIENCE_LIST,
  SAVE_POPUP_DRAFT,
  SEARCH_POPUP_PEOPLE,
  SEND_POPUP_TEST_TO_ME,
  type PopupAudienceInputT,
  type PopupAudienceT,
  type PopupNoticeInputT,
  type PopupPersonHitT,
  type PopupRulesT,
  type PopupShowT,
} from "../../graphql/popupNotice";
import { CLASSES_QUERY } from "../../graphql/operations";
import { Badge, Body, Button, Card, Chip, ChipRow, ErrorBanner, Field, Loader, Muted, Notice, Screen, Select } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { DateField } from "../../components/DateField";
import { SearchField } from "../../components/SearchField";
import { AcademicYearSelect } from "../../components/selects";
import { PopupSheet } from "../../components/PopupSheet";
import { refreshPopupQueue } from "../../components/PopupNoticeHost";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { STR, bnNum, classLevelLabel, dhakaDateKey, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickableSections } from "../../lib/sectionPicks";
import { PRESET_RULES, presetOf, ruleProblems, type PopupPreset } from "../../lib/popupRules";
import type { PopupStackParamList } from "../../navigation/types";
import { space, useColors } from "../../theme";

type Props = NativeStackScreenProps<PopupStackParamList, "PopupCompose">;

const LEVELS = [-1, 0, 1, 2, 3, 4, 5];
const SUBJECTS = ["BAN", "ENG", "MATH", "SCI", "BGS", "ARABIC", "ISLAM", "QURAN"];
const TIMES = Array.from({ length: 34 }, (_, i) => {
  const mins = 6 * 60 + i * 30;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

interface StaffF {
  roles: string[];
  employment: string;
  genders: string[];
  classLevels: number[];
  subjects: string[];
  classTeachersOnly: boolean;
}
const EMPTY_STAFF: StaffF = { roles: [], employment: "current", genders: [], classLevels: [], subjects: [], classTeachersOnly: false };

interface ActionDraft {
  kind: string;
  labelBn: string;
  labelEn: string;
  target: string;
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const toggle = <T,>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** The one-tap segments the owner listed (PRD §3.4). */
const SEGMENTS: Array<{ key: string; label: () => string; staff?: Partial<StaffF>; guardian?: number[] }> = [
  { key: "teachers", label: () => STR.ppSegTeachers, staff: { roles: ["TEACHER"] } },
  { key: "male", label: () => STR.ppSegMaleTeachers, staff: { roles: ["TEACHER"], genders: ["male"] } },
  { key: "female", label: () => STR.ppSegFemaleTeachers, staff: { roles: ["TEACHER"], genders: ["female"] } },
  { key: "kg", label: () => STR.ppSegKgTeachers, staff: { roles: ["TEACHER"], classLevels: [0] } },
  { key: "nkg", label: () => STR.ppSegNurseryKgTeachers, staff: { roles: ["TEACHER"], classLevels: [-1, 0] } },
  { key: "ct", label: () => STR.ppSegClassTeachers, staff: { roles: ["TEACHER"], classTeachersOnly: true } },
  { key: "quran", label: () => STR.ppSegQuranTeachers, staff: { roles: ["TEACHER"], subjects: ["QURAN"] } },
  { key: "office", label: () => STR.ppSegOffice, staff: { roles: ["OFFICE"] } },
  { key: "staff", label: () => STR.ppSegAllStaff, staff: {} },
  { key: "guardians", label: () => STR.ppSegAllGuardians, guardian: [] },
  { key: "gn", label: () => STR.ppSegNurseryGuardians, guardian: [-1] },
  { key: "gkg", label: () => STR.ppSegKgGuardians, guardian: [0] },
  { key: "all", label: () => STR.ppSegEveryone, staff: {}, guardian: [] },
];

/** Screens an "open a screen" button may lead to — tab routes the app already has. */
const SCREEN_TARGETS: Array<{ value: string; label: () => string }> = [
  { value: "GuardianHomeTab", label: () => `${STR.ppForGuardian}: ${STR.gpToday}` },
  { value: "GuardianHomeworkTab", label: () => `${STR.ppForGuardian}: ${STR.tabHomework}` },
  { value: "GuardianRoutineTab", label: () => `${STR.ppForGuardian}: ${STR.tabRoutine}` },
  { value: "GuardianSyllabusTab", label: () => `${STR.ppForGuardian}: ${STR.syTitle}` },
  { value: "GuardianClassTestTab", label: () => `${STR.ppForGuardian}: ${STR.tabClassTest}` },
  { value: "GuardianAssignmentsTab", label: () => `${STR.ppForGuardian}: ${STR.tabAssignment}` },
  { value: "GuardianClassNotesTab", label: () => `${STR.ppForGuardian}: ${STR.drawerItemClassNotes}` },
  { value: "HomeTab", label: () => `${STR.ppForStaff}: ${STR.drawerItemToday}` },
  // D-#871: a screen inside a tab — the meeting-comment guideline (D-#850).
  { value: "HomeTab/MeetingCommentGuide", label: () => `${STR.ppForStaff}: ${STR.mcGuideTitle}` },
  { value: "HomeworkTab", label: () => `${STR.ppForStaff}: ${STR.tabHomework}` },
  { value: "AttendanceTab", label: () => `${STR.ppForStaff}: ${STR.tabAttendance}` },
  { value: "ClassTestTab", label: () => `${STR.ppForStaff}: ${STR.tabClassTest}` },
  { value: "RoutineTab", label: () => `${STR.ppForStaff}: ${STR.tabRoutine}` },
  { value: "ChatTab", label: () => `${STR.ppForStaff}: ${STR.tabChat}` },
];

export default function PopupComposeScreen({ navigation, route }: Props): React.ReactElement {
  const colors = useColors();
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const canStaff = can("popup_notice:send_staff");
  const canGuardian = can("popup_notice:send_guardian");

  const [noticeId, setNoticeId] = useState<string | null>(route.params?.id ?? null);
  const [noticeQ] = useQuery({ query: POPUP_NOTICE, variables: { id: noticeId ?? "" }, pause: !route.params?.id });
  const loaded = noticeQ.data?.popupNotice;
  const live = !!loaded && loaded.status !== "DRAFT";

  const [step, setStep] = useState(0);
  const [staffOn, setStaffOn] = useState(canStaff);
  const [guardOn, setGuardOn] = useState(false);
  const [staff, setStaff] = useState<StaffF>({ ...EMPTY_STAFF, roles: ["TEACHER"] });
  const [guardLevels, setGuardLevels] = useState<number[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<PopupPersonHitT[]>([]);
  /** "KIND:id" of everyone taken out with ✕ on the name list. */
  const [excluded, setExcluded] = useState<string[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [segment, setSegment] = useState<string | null>("teachers");

  const [titleBn, setTitleBn] = useState("");
  const [bodyBn, setBodyBn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [showEn, setShowEn] = useState(false);
  const [tone, setTone] = useState("info");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  const [rules, setRules] = useState<PopupRulesT>(PRESET_RULES.quick);
  const [actions, setActions] = useState<ActionDraft[]>([]);

  const today = dhakaDateKey();
  const [startLater, setStartLater] = useState(false);
  const [startDate, setStartDate] = useState(addDays(today, 1));
  const [startTime, setStartTime] = useState("07:00");
  const [endsOn, setEndsOn] = useState(addDays(today, 7));
  const [repeat, setRepeat] = useState("daily");
  const [reshow, setReshow] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [ayId, setAyId] = useState("");
  const [search, setSearch] = useState("");
  const [peoplePage, setPeoplePage] = useState(1);
  const [showNames, setShowNames] = useState(false);

  // ---- load an existing notice into the form ------------------------------------------
  // Names for hand-picked ids, when a draft or a saved list is opened.
  const [lookup, setLookup] = useState<{ userIds: string[]; studentIds: string[] } | null>(null);
  const [pickedQ] = useQuery({
    query: POPUP_PICKED_PEOPLE,
    variables: lookup ?? { userIds: [], studentIds: [] },
    pause: !lookup || (lookup.userIds.length === 0 && lookup.studentIds.length === 0),
  });
  useEffect(() => {
    if (!loaded) return;
    applyAudience(loaded.audience);
    setLookup({ userIds: loaded.audience.userIds, studentIds: loaded.audience.studentIds });
    setListId(loaded.audienceListId);
    setTitleBn(loaded.titleBn);
    setBodyBn(loaded.bodyBn);
    setTitleEn(loaded.titleEn);
    setBodyEn(loaded.bodyEn);
    setShowEn(!!(loaded.titleEn || loaded.bodyEn));
    setTone(loaded.tone);
    setAttachmentUrl(loaded.attachmentUrl);
    setRules(loaded.rules);
    setActions(loaded.actions.map((a) => ({ kind: a.kind, labelBn: a.labelBn, labelEn: a.labelEn, target: a.target })));
    if (loaded.startsAt && loaded.status === "DRAFT") {
      setStartLater(true);
      const d = new Date(loaded.startsAt);
      setStartDate(dhakaDateKey(d));
      setStartTime(d.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" }));
    }
    setEndsOn(loaded.endsOn);
    setRepeat(loaded.repeat);
    if (loaded.status !== "DRAFT") setStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.id]);
  useEffect(() => {
    if (pickedQ.data) setPicked(pickedQ.data.popupPickedPeople);
  }, [pickedQ.data]);

  function applyAudience(a: PopupAudienceT): void {
    setStaffOn(!!a.staff);
    setStaff(a.staff ? { ...a.staff } : { ...EMPTY_STAFF });
    setGuardOn(!!a.guardian);
    setGuardLevels(a.guardian?.classLevels ?? []);
    setSectionIds(a.guardian?.sectionIds ?? []);
    setExcluded([
      ...(a.excludeUserIds ?? []).map((i) => `USER:${i}`),
      ...(a.excludeGuardianIds ?? []).map((i) => `GUARDIAN:${i}`),
      ...(a.excludeStudentIds ?? []).map((i) => `STUDENT:${i}`),
    ]);
    setSegment(null);
  }

  /** ✕ on a name: a hand-picked staff member just leaves the picks; anyone a filter
   *  matched is taken out ("all teachers except these"), and the server keeps them out. */
  function removePerson(p: { kind: string; id: string }): void {
    if (p.kind === "USER" && picked.some((x) => x.kind === "USER" && x.id === p.id)) {
      setPicked(picked.filter((x) => !(x.kind === "USER" && x.id === p.id)));
      return;
    }
    setExcluded((xs) => [...new Set([...xs, `${p.kind}:${p.id}`])]);
  }

  // ---- the audience the server sees ---------------------------------------------------
  const audience: PopupAudienceInputT = useMemo(
    () => ({
      staff: staffOn ? staff : null,
      guardian: guardOn ? { classLevels: guardLevels, sectionIds } : null,
      userIds: picked.filter((p) => p.kind === "USER").map((p) => p.id),
      studentIds: picked.filter((p) => p.kind === "STUDENT").map((p) => p.id),
      excludeUserIds: excluded.filter((k) => k.startsWith("USER:")).map((k) => k.slice(5)),
      excludeGuardianIds: excluded.filter((k) => k.startsWith("GUARDIAN:")).map((k) => k.slice(9)),
      excludeStudentIds: excluded.filter((k) => k.startsWith("STUDENT:")).map((k) => k.slice(8)),
    }),
    [staffOn, staff, guardOn, guardLevels, sectionIds, picked, excluded],
  );
  const audienceEmpty = !staffOn && !guardOn && picked.length === 0;
  const [previewQ] = useQuery({
    query: POPUP_AUDIENCE_PREVIEW,
    variables: { audience, page: peoplePage, pageSize: 50 },
    pause: audienceEmpty || live,
  });
  const pv = previewQ.data?.popupAudiencePreview;

  const [listsQ, refetchLists] = useQuery({ query: POPUP_AUDIENCE_LISTS_PAGE, variables: { page: 1, pageSize: 100 }, pause: live });
  const lists = listsQ.data?.popupAudienceListsPage.rows ?? [];
  const [searchQ] = useQuery({ query: SEARCH_POPUP_PEOPLE, variables: { query: search, page: 1, pageSize: 20 }, pause: search.trim().length < 2 });
  const hits = (searchQ.data?.searchPopupPeople.rows ?? []).filter(
    (h) => (h.kind === "USER" ? canStaff : canGuardian) && !picked.some((p) => p.id === h.id),
  );
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: ayId }, pause: !guardOn || !ayId });
  const sectionChips = (classesQ.data?.classes ?? [])
    .filter((c) => guardLevels.length === 0 || guardLevels.includes(c.level))
    .flatMap((c) => pickableSections(c.sections).map((s) => ({ id: s.id, label: `${classLevelLabel(c.level)} · ${s.nameBn}` })));

  const [, saveDraft] = useMutation(SAVE_POPUP_DRAFT);
  const [, publish] = useMutation(PUBLISH_POPUP_NOTICE);
  const [, editLive] = useMutation(EDIT_LIVE_POPUP_NOTICE);
  const [, sendTest] = useMutation(SEND_POPUP_TEST_TO_ME);
  const [, deleteDraft] = useMutation(DELETE_POPUP_DRAFT);
  const [, saveList] = useMutation(SAVE_POPUP_AUDIENCE_LIST);
  const [, deleteList] = useMutation(DELETE_POPUP_AUDIENCE_LIST);

  // ---- behaviour ------------------------------------------------------------------------
  const preset: PopupPreset = presetOf(rules);
  const problems = ruleProblems(rules, actions.length, {
    autoWithLock: STR.ppErrAutoWithLock,
    actNeedsButton: STR.ppErrActNeedsButton,
    noWayOut: STR.ppErrNoWayOut,
    autoRange: STR.ppErrAutoRange,
    minRange: STR.ppErrMinRange,
  });
  const setRule = <K extends keyof PopupRulesT>(k: K, v: PopupRulesT[K]) =>
    setRules((r) => {
      const next = { ...r, [k]: v };
      if (k === "mustAct" && v) next.closeButton = false;
      if (k === "mustAct" && !v) next.closeButton = true;
      return next;
    });
  function choosePreset(p: Exclude<PopupPreset, "custom">): void {
    setRules({ ...PRESET_RULES[p], allowAnswerChange: rules.allowAnswerChange });
    if (p === "answer" && actions.length === 0) setActions([{ kind: "ACK", labelBn: STR.ppDefaultAck, labelEn: "", target: "" }]);
  }

  const input = (): PopupNoticeInputT => ({
    titleBn: titleBn.trim(),
    bodyBn: bodyBn.trim(),
    titleEn: showEn ? titleEn.trim() : "",
    bodyEn: showEn ? bodyEn.trim() : "",
    tone,
    attachmentUrl: attachmentUrl.trim(),
    audience,
    audienceListId: listId,
    rules,
    actions: actions.map((a) => ({ kind: a.kind, labelBn: a.labelBn.trim(), labelEn: a.labelEn.trim(), target: a.target.trim() })),
    startsAt: startLater ? new Date(`${startDate}T${startTime}:00+06:00`).toISOString() : null,
    endsOn,
    repeat,
  });

  async function save(): Promise<string | null> {
    const res = await saveDraft({ id: noticeId, input: input() });
    if (res.error || !res.data) {
      setError(friendlyError(res.error));
      return null;
    }
    setNoticeId(res.data.savePopupDraft.id);
    return res.data.savePopupDraft.id;
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const onSaveDraft = () =>
    run(async () => {
      if (await save()) setOkMsg(STR.ppSavedDraft);
    });

  const onTest = () =>
    run(async () => {
      const id = await save();
      if (!id) return;
      const res = await sendTest({ id });
      if (res.error) return setError(friendlyError(res.error));
      setOkMsg(STR.ppTestSent);
      refreshPopupQueue();
    });

  const onSend = () =>
    run(async () => {
      const count = pv ? pv.reachableCount : 0;
      const ok = await confirmAction({
        title: STR.ppConfirmSendTitle,
        message: STR.ppConfirmSendBody.replace("{n}", bnNum(count)),
        confirmLabel: STR.ppSend,
        tone: "primary",
      });
      if (!ok) return;
      const id = await save();
      if (!id) return;
      const res = await publish({ id });
      if (res.error) return setError(friendlyError(res.error));
      navigation.replace("PopupReport", { id });
    });

  const onSaveLive = () =>
    run(async () => {
      if (!noticeId) return;
      const res = await editLive({
        id: noticeId,
        input: {
          titleBn: titleBn.trim(),
          bodyBn: bodyBn.trim(),
          titleEn: showEn ? titleEn.trim() : "",
          bodyEn: showEn ? bodyEn.trim() : "",
          tone,
          attachmentUrl: attachmentUrl.trim(),
          endsOn,
          actionLabelsBn: actions.map((a) => a.labelBn.trim()),
          reshow,
        },
      });
      if (res.error) return setError(friendlyError(res.error));
      navigation.replace("PopupReport", { id: noticeId });
    });

  const onDeleteDraft = () =>
    run(async () => {
      if (!noticeId) return navigation.goBack();
      const ok = await confirmAction({ title: STR.ppDeleteDraftTitle, confirmLabel: STR.ppDelete });
      if (!ok) return;
      const res = await deleteDraft({ id: noticeId });
      if (res.error) return setError(friendlyError(res.error));
      navigation.goBack();
    });

  const onSaveList = () =>
    run(async () => {
      const res = await saveList({ id: listId, name: listName.trim(), audience });
      if (res.error || !res.data) return setError(friendlyError(res.error));
      setListId(res.data.savePopupAudienceList.id);
      setOkMsg(STR.ppListSaved);
      refetchLists({ requestPolicy: "network-only" });
    });

  const onDeleteList = () =>
    run(async () => {
      if (!listId) return;
      const ok = await confirmAction({ title: STR.ppDeleteListTitle, confirmLabel: STR.ppDelete });
      if (!ok) return;
      const res = await deleteList({ id: listId });
      if (res.error) return setError(friendlyError(res.error));
      setListId(null);
      setListName("");
      refetchLists({ requestPolicy: "network-only" });
    });

  // A local, on-device preview of exactly what the recipient will get (sample merge values).
  const sample = (s: string) =>
    s.replace(/\{(নাম|name)\}/gi, STR.ppSampleName).replace(/\{(সন্তান|child)\}/gi, STR.ppSampleChild).replace(/\{(শ্রেণি|class)\}/gi, STR.ppSampleClass);
  const previewShow: PopupShowT = {
    noticeId: "preview",
    version: 1,
    test: true,
    titleBn: sample(titleBn) || STR.ppNoTitle,
    bodyBn: sample(bodyBn) || STR.ppNoBody,
    titleEn: sample(titleEn),
    bodyEn: sample(bodyEn),
    tone,
    attachmentUrl,
    fromLabel: STR.ppPreview,
    rules,
    actions: actions.map((a, i) => ({ id: `a${i + 1}`, kind: a.kind, labelBn: a.labelBn || "…", labelEn: a.labelEn, target: a.target })),
    state: "NOT_SEEN",
    choiceId: null,
    snoozeCount: 0,
    canChangeAnswer: false,
    todayKey: today,
  };

  if (route.params?.id && noticeQ.fetching && !loaded) return <Loader label={STR.loading} />;

  const STEPS = live ? [STR.ppStepContent, STR.ppStepSchedule] : [STR.ppStepWho, STR.ppStepContent, STR.ppStepBehaviour, STR.ppStepSchedule, STR.ppStepSend];
  const stepIndex = live ? (step <= 1 ? 0 : 1) : step;
  const goStep = (i: number) => setStep(live ? (i === 0 ? 1 : 3) : i);
  const last = live ? step === 3 : step === 4;

  return (
    <Screen scroll>
      {live ? <Notice tone="info" message={STR.ppLiveEditHint} /> : null}
      <ChipRow>
        {STEPS.map((s, i) => (
          <Chip key={s} label={`${bnNum(i + 1)} · ${s}`} selected={i === stepIndex} onPress={() => goStep(i)} />
        ))}
      </ChipRow>
      {error ? <ErrorBanner message={error} /> : null}
      {okMsg ? <Notice tone="ok" message={okMsg} /> : null}

      {/* ---------------- ১ প্রাপক ---------------- */}
      {step === 0 && !live ? (
        <>
          <Card>
            <Muted>{STR.ppWhoQuestion}</Muted>
            <ChipRow>
              {canStaff ? <Chip label={STR.ppWhoStaff} selected={staffOn} onPress={() => { setStaffOn(!staffOn); setSegment(null); }} /> : null}
              {canGuardian ? <Chip label={STR.ppWhoGuardians} selected={guardOn} onPress={() => { setGuardOn(!guardOn); setSegment(null); }} /> : null}
            </ChipRow>
            <Muted style={{ marginTop: space(2) }}>{STR.ppSegments}</Muted>
            <ChipRow>
              {SEGMENTS.filter((s) => (!s.staff || canStaff) && (!s.guardian || canGuardian)).map((s) => (
                <Chip
                  key={s.key}
                  label={s.label()}
                  selected={segment === s.key}
                  onPress={() => {
                    setSegment(s.key);
                    setStaffOn(!!s.staff);
                    setStaff({ ...EMPTY_STAFF, ...(s.staff ?? {}) });
                    setGuardOn(!!s.guardian);
                    setGuardLevels(s.guardian ?? []);
                    setSectionIds([]);
                    setPicked([]);
                    setExcluded([]);
                    setListId(null);
                  }}
                />
              ))}
            </ChipRow>
            {lists.length > 0 ? (
              <>
                <Muted style={{ marginTop: space(2) }}>{STR.ppSavedLists}</Muted>
                <ChipRow>
                  {lists.map((l) => (
                    <Chip
                      key={l.id}
                      label={`★ ${l.name}`}
                      selected={listId === l.id}
                      onPress={() => {
                        applyAudience(l.audience);
                        setListId(l.id);
                        setListName(l.name);
                        setPicked([]);
                        setLookup({ userIds: l.audience.userIds, studentIds: l.audience.studentIds });
                      }}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}
          </Card>

          {staffOn ? (
            <Card>
              <Body style={{ fontWeight: "600" }}>{STR.ppWhoStaff}</Body>
              <Muted>{STR.ppRole}</Muted>
              <ChipRow>
                {[["TEACHER", STR.ppRoleTeacher], ["OFFICE", STR.ppRoleOffice], ["PRINCIPAL", STR.ppRolePrincipal]].map(([v, l]) => (
                  <Chip key={v} label={l} selected={staff.roles.includes(v)} onPress={() => { setStaff({ ...staff, roles: toggle(staff.roles, v) }); setSegment(null); }} />
                ))}
              </ChipRow>
              <Muted>{STR.ppEmployment}</Muted>
              <ChipRow>
                {[["current", STR.ppEmpCurrent], ["probation", STR.ppEmpProbation], ["confirmed", STR.ppEmpConfirmed]].map(([v, l]) => (
                  <Chip key={v} label={l} selected={staff.employment === v} onPress={() => { setStaff({ ...staff, employment: v }); setSegment(null); }} />
                ))}
              </ChipRow>
              <Muted>{STR.ppGender}</Muted>
              <ChipRow>
                {[["male", STR.ppMale], ["female", STR.ppFemale]].map(([v, l]) => (
                  <Chip key={v} label={l} selected={staff.genders.includes(v)} onPress={() => { setStaff({ ...staff, genders: toggle(staff.genders, v) }); setSegment(null); }} />
                ))}
              </ChipRow>
              <Muted>{STR.ppTeachesClass}</Muted>
              <ChipRow>
                {LEVELS.map((l) => (
                  <Chip key={l} label={classLevelLabel(l)} selected={staff.classLevels.includes(l)} onPress={() => { setStaff({ ...staff, classLevels: toggle(staff.classLevels, l) }); setSegment(null); }} />
                ))}
              </ChipRow>
              <Muted>{STR.ppTeachesSubject}</Muted>
              <ChipRow>
                {SUBJECTS.map((s) => (
                  <Chip key={s} label={routineSubjectLabel(s)} selected={staff.subjects.includes(s)} onPress={() => { setStaff({ ...staff, subjects: toggle(staff.subjects, s) }); setSegment(null); }} />
                ))}
              </ChipRow>
              <ChipRow>
                <Chip label={STR.ppClassTeachersOnly} selected={staff.classTeachersOnly} onPress={() => { setStaff({ ...staff, classTeachersOnly: !staff.classTeachersOnly }); setSegment(null); }} />
              </ChipRow>
            </Card>
          ) : null}

          {guardOn ? (
            <Card>
              <Body style={{ fontWeight: "600" }}>{STR.ppWhoGuardians}</Body>
              <Muted>{STR.ppChildClass}</Muted>
              <ChipRow>
                {LEVELS.map((l) => (
                  <Chip key={l} label={classLevelLabel(l)} selected={guardLevels.includes(l)} onPress={() => { setGuardLevels(toggle(guardLevels, l)); setSegment(null); }} />
                ))}
              </ChipRow>
              <Muted>{STR.ppSections}</Muted>
              <AcademicYearSelect value={ayId} onChange={setAyId} />
              <ChipRow>
                {sectionChips.map((s) => (
                  <Chip key={s.id} label={s.label} selected={sectionIds.includes(s.id)} onPress={() => { setSectionIds(toggle(sectionIds, s.id)); setSegment(null); }} />
                ))}
              </ChipRow>
            </Card>
          ) : null}

          <Card>
            <Body style={{ fontWeight: "600" }}>{STR.ppPickPeople}</Body>
            <Muted>{STR.ppPickHint}</Muted>
            <SearchField value={search} onSearch={setSearch} placeholder={STR.ppSearchPlaceholder} />
            {hits.map((h) => (
              <View key={`${h.kind}:${h.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(1) }}>
                <Body style={{ flex: 1 }}>
                  {h.kind === "STUDENT" ? `${STR.ppFamilyOf} ${h.name}` : h.name}
                  <Muted>{`  ${h.detail}`}</Muted>
                </Body>
                <Button title={STR.ppAdd} variant="secondary" onPress={() => { setPicked([...picked, h]); setSegment(null); }} />
              </View>
            ))}
            {picked.length > 0 ? (
              <ChipRow>
                {picked.map((p) => (
                  <Chip key={`${p.kind}:${p.id}`} label={`✕ ${p.kind === "STUDENT" ? `${STR.ppFamilyOf} ` : ""}${p.name}`} selected onPress={() => setPicked(picked.filter((x) => x !== p))} />
                ))}
              </ChipRow>
            ) : null}
          </Card>

          <Card>
            <Body style={{ fontWeight: "600" }}>{STR.ppWhoGets}</Body>
            {audienceEmpty ? (
              <Muted>{STR.ppNobodyYet}</Muted>
            ) : previewQ.fetching && !pv ? (
              <Loader />
            ) : pv ? (
              <>
                <Body style={{ fontSize: 26, fontWeight: "700" }}>{STR.ppPeopleCount.replace("{n}", bnNum(pv.total))}</Body>
                <Muted>{pv.summary}</Muted>
                {staffOn || picked.some((p) => p.kind === "USER") ? <Muted>{STR.ppStaffCount.replace("{n}", bnNum(pv.staffCount))}</Muted> : null}
                {pv.guardianCount > 0 ? <Muted>{STR.ppFamilyCount.replace("{n}", bnNum(pv.guardianCount)).replace("{r}", bnNum(pv.guardianCount - pv.unreachableCount))}</Muted> : null}
                {pv.unreachableCount > 0 ? <Notice tone="warn" message={STR.ppNoLoginWarn.replace("{n}", bnNum(pv.unreachableCount))} /> : null}
                {pv.staffMissingGender > 0 ? <Notice tone="warn" message={STR.ppMissingGender.replace("{n}", bnNum(pv.staffMissingGender))} /> : null}
                {pv.total === 0 ? <Notice tone="danger" message={STR.ppNoMatch} /> : null}
                <Button title={showNames ? STR.ppHideNames : STR.ppShowNames} variant="ghost" onPress={() => setShowNames(!showNames)} />
                {showNames ? (
                  <>
                    {pv.people.rows.map((p) => (
                      <View key={`${p.kind}:${p.id}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                        <Body style={{ flexGrow: 1 }}>{p.name}</Body>
                        <Muted>{p.detail}</Muted>
                        {!p.reachable ? <Badge text={STR.ppNoLogin} tone="warn" /> : null}
                        <Pressable
                          onPress={() => removePerson(p)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`${STR.ppRemovePerson}: ${p.name}`}
                          style={({ pressed }) => ({
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: pressed ? colors.errorContainer : colors.surfaceAlt,
                          })}
                        >
                          <Muted style={{ fontWeight: "700", color: colors.error }}>✕</Muted>
                        </Pressable>
                      </View>
                    ))}
                    <Pager page={pv.people.page} pageSize={pv.people.pageSize} total={pv.people.total} onPage={setPeoplePage} />
                  </>
                ) : null}
                {pv.excluded.length > 0 ? (
                  <>
                    <Muted style={{ marginTop: space(2) }}>{STR.ppExcludedTitle.replace("{n}", bnNum(pv.excluded.length))}</Muted>
                    <ChipRow>
                      {pv.excluded.map((p) => (
                        <Chip
                          key={`${p.kind}:${p.id}`}
                          label={`↺ ${p.name}`}
                          onPress={() => setExcluded((xs) => xs.filter((k) => k !== `${p.kind}:${p.id}`))}
                        />
                      ))}
                    </ChipRow>
                  </>
                ) : null}
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  <Field label={STR.ppListName} value={listName} onChangeText={setListName} placeholder={STR.ppListNamePlaceholder} />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    <Button title={listId ? STR.ppUpdateList : STR.ppSaveList} variant="secondary" onPress={() => void onSaveList()} disabled={busy || !listName.trim()} />
                    {listId ? <Button title={STR.ppDeleteList} variant="ghost" onPress={() => void onDeleteList()} disabled={busy} /> : null}
                  </View>
                </View>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {/* ---------------- ২ বার্তা ---------------- */}
      {step === 1 ? (
        <Card>
          <Field label={STR.ppTitle} value={titleBn} onChangeText={setTitleBn} placeholder={STR.ppTitlePlaceholder} />
          <Field label={STR.ppBody} value={bodyBn} onChangeText={setBodyBn} multiline inputStyle={{ minHeight: 160 }} helper={STR.ppBodyHelper} />
          <Muted>{STR.ppMergeFields}</Muted>
          <ChipRow>
            {["{নাম}", "{সন্তান}", "{শ্রেণি}"].map((m) => (
              <Chip key={m} label={`＋ ${m}`} onPress={() => setBodyBn(`${bodyBn}${bodyBn && !bodyBn.endsWith(" ") ? " " : ""}${m}`)} />
            ))}
          </ChipRow>
          <Muted>{STR.ppMergeHelp}</Muted>
          <Muted style={{ marginTop: space(2) }}>{STR.ppTone}</Muted>
          <ChipRow>
            {[["info", STR.ppToneInfo], ["important", STR.ppToneImportant], ["urgent", STR.ppToneUrgent]].map(([v, l]) => (
              <Chip key={v} label={l} selected={tone === v} onPress={() => setTone(v)} />
            ))}
          </ChipRow>
          <Field label={STR.ppAttachment} value={attachmentUrl} onChangeText={setAttachmentUrl} placeholder="https://…" helper={STR.ppAttachmentHelper} />
          <ChipRow>
            <Chip label={STR.ppAddEnglish} selected={showEn} onPress={() => setShowEn(!showEn)} />
          </ChipRow>
          {showEn ? (
            <>
              <Field label={STR.ppTitleEn} value={titleEn} onChangeText={setTitleEn} />
              <Field label={STR.ppBodyEn} value={bodyEn} onChangeText={setBodyEn} multiline inputStyle={{ minHeight: 120 }} />
            </>
          ) : null}
          {live && actions.length > 0 ? (
            <>
              <Muted style={{ marginTop: space(2) }}>{STR.ppButtonLabels}</Muted>
              {actions.map((a, i) => (
                <Field key={i} value={a.labelBn} onChangeText={(t) => setActions(actions.map((x, j) => (j === i ? { ...x, labelBn: t } : x)))} />
              ))}
            </>
          ) : null}
          <Button title={STR.ppPreviewButton} variant="secondary" onPress={() => setPreview(true)} />
        </Card>
      ) : null}

      {/* ---------------- ৩ আচরণ ---------------- */}
      {step === 2 && !live ? (
        <>
          <Card>
            <Muted>{STR.ppPresetHint}</Muted>
            {([
              ["quick", STR.ppPresetQuick, STR.ppPresetQuickHint],
              ["read", STR.ppPresetRead, STR.ppPresetReadHint],
              ["attentive", STR.ppPresetAttentive, STR.ppPresetAttentiveHint],
              ["answer", STR.ppPresetAnswer, STR.ppPresetAnswerHint],
            ] as Array<[Exclude<PopupPreset, "custom">, string, string]>).map(([k, t, h]) => (
              <Card key={k} onPress={() => choosePreset(k)} style={preset === k ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
                <Body style={{ fontWeight: "600" }}>{t}</Body>
                <Muted>{h}</Muted>
              </Card>
            ))}
            {preset === "custom" ? <Muted>{STR.ppPresetCustom}</Muted> : null}
          </Card>

          <Card>
            <SwitchRow label={STR.ppRuleAuto} help={STR.ppRuleAutoHelp} value={rules.autoCloseSec > 0} onChange={(v) => setRule("autoCloseSec", v ? 5 : 0)} />
            {rules.autoCloseSec > 0 ? (
              <Field label={STR.ppSeconds} value={String(rules.autoCloseSec)} keyboardType="number-pad" onChangeText={(t) => setRule("autoCloseSec", Number(t.replace(/\D/g, "")) || 0)} />
            ) : null}
            <SwitchRow label={STR.ppRuleClose} help={STR.ppRuleCloseHelp} value={rules.closeButton} disabled={rules.mustAct} onChange={(v) => setRule("closeButton", v)} />
            <SwitchRow label={STR.ppRuleScroll} help={STR.ppRuleScrollHelp} value={rules.mustScrollToEnd} onChange={(v) => setRule("mustScrollToEnd", v)} />
            <SwitchRow label={STR.ppRuleMin} help={STR.ppRuleMinHelp} value={rules.minReadSec > 0} onChange={(v) => setRule("minReadSec", v ? 30 : 0)} />
            {rules.minReadSec > 0 ? (
              <Field label={STR.ppSeconds} value={String(rules.minReadSec)} keyboardType="number-pad" onChangeText={(t) => setRule("minReadSec", Number(t.replace(/\D/g, "")) || 0)} />
            ) : null}
            <SwitchRow
              label={STR.ppRuleAct}
              help={STR.ppRuleActHelp}
              value={rules.mustAct}
              onChange={(v) => {
                setRule("mustAct", v);
                if (v && actions.length === 0) setActions([{ kind: "ACK", labelBn: STR.ppDefaultAck, labelEn: "", target: "" }]);
              }}
            />
            <SwitchRow label={STR.ppRuleSnooze} help={STR.ppRuleSnoozeHelp} value={rules.allowSnooze} onChange={(v) => setRule("allowSnooze", v)} />
          </Card>

          <Card>
            <Body style={{ fontWeight: "600" }}>{STR.ppButtons}</Body>
            <Muted>{rules.mustAct ? STR.ppButtonsRequired : STR.ppButtonsOptional}</Muted>
            {actions.map((a, i) => (
              <View key={i} style={{ gap: space(1), marginTop: space(2) }}>
                <Field label={`${STR.ppButton} ${bnNum(i + 1)}`} value={a.labelBn} onChangeText={(t) => setActions(actions.map((x, j) => (j === i ? { ...x, labelBn: t } : x)))} />
                <Select
                  value={a.kind}
                  options={[
                    { value: "ACK", label: STR.ppKindAck },
                    { value: "CHOICE", label: STR.ppKindChoice },
                    { value: "OPEN_SCREEN", label: STR.ppKindScreen },
                    { value: "OPEN_LINK", label: STR.ppKindLink },
                  ]}
                  onChange={(k) => setActions(actions.map((x, j) => (j === i ? { ...x, kind: k, target: "" } : x)))}
                />
                {a.kind === "OPEN_SCREEN" ? (
                  <Select
                    value={a.target || null}
                    placeholder={STR.ppPickScreen}
                    options={SCREEN_TARGETS.map((t) => ({ value: t.value, label: t.label() }))}
                    onChange={(v) => setActions(actions.map((x, j) => (j === i ? { ...x, target: v } : x)))}
                  />
                ) : null}
                {a.kind === "OPEN_LINK" ? (
                  <Field value={a.target} placeholder="https://…" onChangeText={(t) => setActions(actions.map((x, j) => (j === i ? { ...x, target: t } : x)))} />
                ) : null}
                <Button title={STR.ppRemoveButton} variant="ghost" onPress={() => setActions(actions.filter((_, j) => j !== i))} />
              </View>
            ))}
            {actions.length < 3 ? (
              <Button title={STR.ppAddButton} variant="secondary" onPress={() => setActions([...actions, { kind: "CHOICE", labelBn: "", labelEn: "", target: "" }])} />
            ) : null}
            {actions.some((a) => a.kind === "CHOICE") ? (
              <SwitchRow label={STR.ppRuleChange} help={STR.ppRuleChangeHelp} value={rules.allowAnswerChange} onChange={(v) => setRule("allowAnswerChange", v)} />
            ) : null}
          </Card>

          {problems.length > 0 ? problems.map((p) => <Notice key={p} tone="danger" message={p} />) : <Notice tone="ok" message={STR.ppRulesOk} />}
          <Card>
            <Body style={{ fontWeight: "600" }}>{STR.ppWhatTheySee}</Body>
            {rules.autoCloseSec > 0 ? <Muted>{`• ${STR.ppSeeAuto.replace("{n}", bnNum(rules.autoCloseSec))}`}</Muted> : null}
            {rules.mustScrollToEnd ? <Muted>{`• ${STR.ppSeeScroll}`}</Muted> : null}
            {rules.minReadSec > 0 ? <Muted>{`• ${STR.ppSeeMin.replace("{n}", bnNum(rules.minReadSec))}`}</Muted> : null}
            {rules.mustAct ? <Muted>{`• ${STR.ppSeeAct}`}</Muted> : rules.closeButton ? <Muted>{`• ${STR.ppSeeClose}`}</Muted> : null}
            {rules.allowSnooze ? <Muted>{`• ${STR.ppSeeSnooze}`}</Muted> : null}
            <Button title={STR.ppPreviewButton} variant="secondary" onPress={() => setPreview(true)} />
          </Card>
        </>
      ) : null}

      {/* ---------------- ৪ সময় ---------------- */}
      {step === 3 ? (
        <Card>
          {!live ? (
            <>
              <Muted>{STR.ppStart}</Muted>
              <ChipRow>
                <Chip label={STR.ppStartNow} selected={!startLater} onPress={() => setStartLater(false)} />
                <Chip label={STR.ppStartLater} selected={startLater} onPress={() => setStartLater(true)} />
              </ChipRow>
              {startLater ? (
                <>
                  <DateField label={STR.ppStartDate} value={startDate} onChange={setStartDate} min={today} />
                  <Select label={STR.ppStartTime} value={startTime} options={TIMES.map((t) => ({ value: t, label: t }))} onChange={setStartTime} />
                </>
              ) : null}
            </>
          ) : null}
          <DateField label={STR.ppEndsOn} value={endsOn} onChange={setEndsOn} min={today} helper={STR.ppEndsOnHelp} />
          {!live ? (
            <>
              <Muted style={{ marginTop: space(2) }}>{STR.ppRepeat}</Muted>
              {[
                ["once", STR.ppRepeatOnce, STR.ppRepeatOnceHelp],
                ["daily", STR.ppRepeatDaily, STR.ppRepeatDailyHelp],
                ["every_open", STR.ppRepeatEvery, STR.ppRepeatEveryHelp],
                ["window", STR.ppRepeatWindow, STR.ppRepeatWindowHelp],
              ].map(([v, t, h]) => (
                <Card key={v} onPress={() => setRepeat(v)} style={repeat === v ? { borderColor: colors.primary, borderWidth: 2 } : undefined}>
                  <Body style={{ fontWeight: "600" }}>{t}</Body>
                  <Muted>{h}</Muted>
                </Card>
              ))}
            </>
          ) : (
            <SwitchRow label={STR.ppReshow} help={STR.ppReshowHelp} value={reshow} onChange={setReshow} />
          )}
        </Card>
      ) : null}

      {/* ---------------- ৫ পাঠান ---------------- */}
      {step === 4 && !live ? (
        <Card>
          <ReviewRow k={STR.ppStepWho} v={pv ? `${pv.summary} — ${STR.ppPeopleCount.replace("{n}", bnNum(pv.total))}` : STR.ppNobodyYet} />
          {pv && pv.unreachableCount > 0 ? <Muted>{STR.ppNoLoginWarn.replace("{n}", bnNum(pv.unreachableCount))}</Muted> : null}
          <ReviewRow k={STR.ppTitle} v={titleBn || STR.ppNoTitle} />
          <ReviewRow k={STR.ppTone} v={tone === "urgent" ? STR.ppToneUrgent : tone === "important" ? STR.ppToneImportant : STR.ppToneInfo} />
          <ReviewRow
            k={STR.ppStepBehaviour}
            v={[
              rules.autoCloseSec > 0 ? STR.ppSeeAuto.replace("{n}", bnNum(rules.autoCloseSec)) : "",
              rules.mustScrollToEnd ? STR.ppSeeScroll : "",
              rules.minReadSec > 0 ? STR.ppSeeMin.replace("{n}", bnNum(rules.minReadSec)) : "",
              rules.mustAct ? `${STR.ppSeeAct} (${actions.map((a) => a.labelBn).join(" / ")})` : "",
            ].filter(Boolean).join(" · ") || STR.ppSeeClose}
          />
          <ReviewRow
            k={STR.ppStepSchedule}
            v={`${startLater ? `${bnNum(startDate)} ${bnNum(startTime)}` : STR.ppStartNow} → ${bnNum(endsOn)} · ${
              { once: STR.ppRepeatOnce, daily: STR.ppRepeatDaily, every_open: STR.ppRepeatEvery, window: STR.ppRepeatWindow }[repeat] ?? repeat
            }`}
          />
          <Muted style={{ marginTop: space(2) }}>{STR.ppTestHelp}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Button title={STR.ppPreviewButton} variant="secondary" onPress={() => setPreview(true)} />
            <Button title={STR.ppSendToMe} variant="secondary" onPress={() => void onTest()} disabled={busy} />
            {attachmentUrl ? <Button title={STR.ppOpenAttachment} variant="ghost" onPress={() => void Linking.openURL(attachmentUrl)} /> : null}
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(3), marginBottom: space(6) }}>
        {stepIndex > 0 ? <Button title={STR.ppPrevStep} variant="secondary" onPress={() => goStep(stepIndex - 1)} /> : null}
        {!last ? <Button title={STR.ppNextStep} onPress={() => goStep(stepIndex + 1)} /> : null}
        {live ? (
          last ? <Button title={STR.ppSaveChanges} onPress={() => void onSaveLive()} loading={busy} /> : null
        ) : (
          <>
            <Button title={STR.ppSaveDraft} variant="secondary" onPress={() => void onSaveDraft()} disabled={busy} />
            {last ? <Button title={STR.ppSend} onPress={() => void onSend()} loading={busy} disabled={audienceEmpty || problems.length > 0} /> : null}
            {noticeId ? <Button title={STR.ppDeleteDraft} variant="ghost" onPress={() => void onDeleteDraft()} disabled={busy} /> : null}
          </>
        )}
      </View>

      {preview ? (
        <PopupSheet
          show={previewShow}
          onClose={() => setPreview(false)}
          onSnooze={() => setPreview(false)}
          onAct={async () => {
            setPreview(false);
            return null;
          }}
        />
      ) : null}
    </Screen>
  );
}

function SwitchRow({ label, help, value, onChange, disabled }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) }}>
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: "600" }}>{label}</Body>
        <Muted>{help}</Muted>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

function ReviewRow({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), paddingVertical: space(1) }}>
      <Muted style={{ width: 110 }}>{k}</Muted>
      <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200 }}>{v}</Body>
    </View>
  );
}
