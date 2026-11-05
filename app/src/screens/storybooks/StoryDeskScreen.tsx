/**
 * StoryDeskScreen (SB-2, W6 + W7) — the storybook desk on the office phone or PC.
 *
 * One box takes the copy code (typed, or a USB / phone scanner typing it + Enter). Then:
 *  - the book is with a child → "পুরো বই পড়েছে?" (yes = sticker) → ফেরত নিন; if another
 *    child is waiting the desk is told to keep it aside for them;
 *  - the book is in (or held for a child) → pick the child by school ID / name / roll, or
 *    from today's list, and lend it. The 2-book limit, holiday rule and overdue block are
 *    the server's (issueBook).
 * Gate: library:lend + the librarian duty (the server's assertIsLibrarian).
 */
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useClient, useMutation, useQuery } from "urql";
import { COPY_STATUS_LABELS_BN } from "@scd/shared";
import {
  STORY_COPY_BY_CODE,
  STORY_DESK_STUDENTS,
  STORY_DESK_TODAY,
  STORY_ISSUE,
  STORY_RETURN,
  type StoryCopyLookupT,
  type StoryDeskStudentT,
} from "../../graphql/storybooks";
import { Badge, Body, Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, isoDateLabel } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";
import { StoryImage } from "./StoryImage";

type Msg = { tone: "ok" | "danger" | "info"; text: string } | null;

function StudentRow({ s, onPick, picked }: { s: StoryDeskStudentT; onPick: () => void; picked: boolean }): React.ReactElement {
  const colors = useColors();
  const full = s.activeLoans >= s.maxLoans;
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space(2),
        padding: space(2),
        borderRadius: 8,
        borderWidth: picked ? 2 : 1,
        borderColor: picked ? colors.primary : colors.border,
        marginBottom: space(2),
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{s.name}</Text>
        <Muted style={{ fontSize: 12 }}>
          {s.classLabelBn}
          {s.sectionNameBn ? ` · ${s.sectionNameBn}` : ""}
          {s.rollNumber ? ` · রোল ${bnNum(s.rollNumber)}` : ""} · আইডি {s.schoolId}
        </Muted>
      </View>
      {s.overdue ? <Badge text={STR.stbDeskOverdue} tone="danger" /> : null}
      <Badge text={full ? STR.stbDeskFull : STR.stbDeskLoans.replace("{n}", bnNum(s.activeLoans)).replace("{max}", bnNum(s.maxLoans))} tone={full ? "warn" : "ok"} />
    </Pressable>
  );
}

function LendPanel({ copy, onDone }: { copy: StoryCopyLookupT; onDone: (m: Msg) => void }): React.ReactElement {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<StoryDeskStudentT | null>(copy.heldFor);
  const [todayQ] = useQuery({ query: STORY_DESK_TODAY, requestPolicy: "network-only" });
  const [hitsQ] = useQuery({ query: STORY_DESK_STUDENTS, variables: { search: term }, pause: !term });
  const [{ fetching }, issue] = useMutation(STORY_ISSUE);
  const hits = term ? hitsQ.data?.storyDeskStudents ?? [] : [];
  const today = todayQ.data?.storyDeskToday ?? [];

  const lend = async (): Promise<void> => {
    if (!picked) return;
    const res = await issue({ accessionNo: copy.code, borrowerId: picked.id });
    if (res.error) return onDone({ tone: "danger", text: friendlyError(res.error) });
    onDone({
      tone: "ok",
      text: STR.stbDeskGiven.replace("{book}", copy.titleBn).replace("{name}", picked.name).replace("{due}", isoDateLabel(res.data?.issueBook.dueDate)),
    });
  };

  return (
    <View style={{ gap: space(2) }}>
      {copy.heldFor ? (
        <Notice tone="info" message={STR.stbDeskHoldFor.replace("{name}", copy.heldFor.name).replace("{cls}", copy.heldFor.classLabelBn)} />
      ) : null}
      <Field
        label={STR.stbDeskWho}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setTerm(search.trim())}
        returnKeyType="search"
      />
      <Button title={STR.stbDeskFind} variant="secondary" onPress={() => setTerm(search.trim())} />
      {term && !hitsQ.fetching && hits.length === 0 ? <Muted>{STR.stbDeskNoMatch}</Muted> : null}
      {hits.map((s) => (
        <StudentRow key={s.id} s={s} picked={picked?.id === s.id} onPick={() => setPicked(s)} />
      ))}
      {!term && today.length > 0 ? (
        <View>
          <Muted style={{ marginBottom: space(1) }}>{STR.stbDeskToday}</Muted>
          {today.map((s) => (
            <StudentRow key={s.id} s={s} picked={picked?.id === s.id} onPick={() => setPicked(s)} />
          ))}
        </View>
      ) : null}
      {picked ? <Button title={STR.stbDeskGive.replace("{name}", picked.name)} loading={fetching} onPress={() => void lend()} /> : null}
    </View>
  );
}

function ReturnPanel({ copy, onDone }: { copy: StoryCopyLookupT; onDone: (m: Msg, reload: boolean) => void }): React.ReactElement {
  const colors = useColors();
  const [read, setRead] = useState(true);
  const [{ fetching }, ret] = useMutation(STORY_RETURN);
  const who = copy.borrower;
  const overdue = !!copy.dueDate && new Date(copy.dueDate).getTime() < Date.now();
  const back = async (): Promise<void> => {
    const res = await ret({ loanId: copy.loanId!, read, sticker: read });
    if (res.error) return onDone({ tone: "danger", text: friendlyError(res.error) }, false);
    onDone({ tone: "ok", text: read && who ? STR.stbDeskReturnedSticker.replace("{name}", who.name) : STR.stbDeskReturned }, true);
  };
  return (
    <View style={{ gap: space(2) }}>
      <Body>
        {STR.stbDeskWith
          .replace("{name}", who ? `${who.name} (${who.classLabelBn})` : "—")
          .replace("{issued}", isoDateLabel(copy.issuedAt))
          .replace("{due}", isoDateLabel(copy.dueDate))}
      </Body>
      {overdue ? <Badge text={STR.stbDeskOverdue} tone="danger" /> : null}
      <Muted>{STR.stbDeskReadQ}</Muted>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        {[true, false].map((v) => (
          <Pressable
            key={String(v)}
            onPress={() => setRead(v)}
            accessibilityRole="button"
            style={{
              flex: 1,
              padding: space(2),
              borderRadius: 8,
              alignItems: "center",
              borderWidth: read === v ? 2 : 1,
              borderColor: read === v ? colors.primary : colors.border,
            }}
          >
            <Text style={{ ...typeScale.bodyStrong, color: read === v ? colors.primary : colors.textPrimary }}>{v ? STR.stbDeskReadYes : STR.stbDeskReadNo}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={STR.stbDeskReturn} loading={fetching} onPress={() => void back()} />
    </View>
  );
}

export default function StoryDeskScreen(): React.ReactElement {
  const client = useClient();
  const [code, setCode] = useState("");
  const [copy, setCopy] = useState<StoryCopyLookupT | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const find = async (raw = code): Promise<void> => {
    if (!raw.trim()) return;
    setBusy(true);
    const res = await client.query(STORY_COPY_BY_CODE, { code: raw }, { requestPolicy: "network-only" }).toPromise();
    setBusy(false);
    if (res.error) {
      setCopy(null);
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    setMsg(null);
    setCopy(res.data?.storyCopyByCode ?? null);
  };

  const finish = async (m: Msg, reload = false): Promise<void> => {
    if (reload && copy) {
      // After a return: if another child waits, the copy is now held — say so.
      const res = await client.query(STORY_COPY_BY_CODE, { code: copy.code }, { requestPolicy: "network-only" }).toPromise();
      const held = res.data?.storyCopyByCode.heldFor;
      setMsg(held ? { tone: "info", text: `${m?.text ?? ""}\n${STR.stbDeskHoldFor.replace("{name}", held.name).replace("{cls}", held.classLabelBn)}` } : m);
    } else {
      setMsg(m);
    }
    if (m?.tone !== "danger") {
      setCopy(null);
      setCode("");
    }
  };

  const lendable = copy && !copy.loanId && (copy.status === "AVAILABLE" || copy.status === "ON_HOLD");

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <Notice tone="info" message={STR.stbDeskHint} />
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        <Card>
          <Field
            label={STR.stbDeskCode}
            value={code}
            onChangeText={setCode}
            placeholder={STR.stbDeskCodePh}
            autoCapitalize="characters"
            onSubmitEditing={() => void find()}
            returnKeyType="search"
          />
          <Button title={STR.stbDeskFind} loading={busy} onPress={() => void find()} />
        </Card>
        {copy ? (
          <Card>
            <View style={{ flexDirection: "row", gap: space(3), alignItems: "center", marginBottom: space(3) }}>
              <View style={{ width: 96 }}>
                <StoryImage fileId={copy.coverFileId} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Body style={{ fontWeight: "700" }}>{copy.titleBn}</Body>
                <Muted>
                  {copy.seriesNameBn ?? ""}
                  {copy.seriesNo != null ? ` · ${STR.stbBookNo.replace("{n}", bnNum(copy.seriesNo))}` : ""}
                </Muted>
                <Muted style={{ fontSize: 12 }}>
                  {copy.code}
                  {copy.waitingCount > 0 ? ` · ${STR.stbWaitingLine.replace("{n}", bnNum(copy.waitingCount))}` : ""}
                </Muted>
              </View>
            </View>
            {copy.loanId ? (
              <ReturnPanel copy={copy} onDone={(m, reload) => void finish(m, reload)} />
            ) : lendable ? (
              <LendPanel copy={copy} onDone={(m) => void finish(m)} />
            ) : (
              <Notice tone="danger" message={STR.stbDeskNotLendable.replace("{status}", COPY_STATUS_LABELS_BN[copy.status as keyof typeof COPY_STATUS_LABELS_BN] ?? copy.status)} />
            )}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
