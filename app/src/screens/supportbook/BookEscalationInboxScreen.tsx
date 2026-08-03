/**
 * BookEscalationInboxScreen (SB-3, D-#410) — the senior reviewer's inbox.
 *
 * OLDEST FIRST, and the server sorts it that way deliberately: the thread that has
 * waited longest is the one blocking a lesson, and a newest-first inbox quietly
 * starves exactly those. This screen does not re-sort.
 *
 * A RESOLUTION CHANGES NOTHING IN THE BOOK. That is the whole design of D-#410 and the
 * easiest thing to misread, so the screen says it in words next to the resolve form:
 * the senior rules, and the AUTHOR then submits a patch citing that ruling, through the
 * same validator as every other change. A senior who thinks resolving edits the lesson
 * will close threads and wonder why nothing moved.
 *
 * Replying and resolving are different permissions (book:review vs book:review_senior),
 * so the resolve form only renders for a caller who actually holds the senior grant.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  SUPPORT_BOOKS, SUPPORT_BOOK_ESCALATIONS,
  REPLY_SUPPORT_BOOK_ESCALATION, RESOLVE_SUPPORT_BOOK_ESCALATION,
  type SupportBookT, type SupportBookEscalationT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, Chip, ChipRow, Field, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, escalationStateLabel, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useAuth } from "../../auth/AuthContext";
import { space, useColors } from "../../theme";

function toneFor(state: string): "warn" | "info" | "ok" | "muted" {
  if (state === "OPEN") return "warn";
  if (state === "ANSWERED") return "info";
  if (state === "RESOLVED") return "ok";
  return "muted";
}

function Thread({
  esc,
  canResolve,
  onChanged,
}: {
  esc: SupportBookEscalationT;
  canResolve: boolean;
  onChanged: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [reply, setReply] = useState("");
  const [ruling, setRuling] = useState("");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const [replyRes, sendReply] = useMutation(REPLY_SUPPORT_BOOK_ESCALATION);
  const [resolveRes, sendResolve] = useMutation(RESOLVE_SUPPORT_BOOK_ESCALATION);

  async function onReply(): Promise<void> {
    setNote(null);
    if (!reply.trim()) return;
    const res = await sendReply({ escalationId: esc.escalationId, body: reply.trim() });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setReply("");
    onChanged();
  }

  async function onResolve(): Promise<void> {
    setNote(null);
    if (!ruling.trim()) return;
    const res = await sendResolve({ escalationId: esc.escalationId, resolution: ruling.trim() });
    if (res.error) {
      setNote({ text: friendlyError(res.error), bad: true });
      return;
    }
    setRuling("");
    onChanged();
  }

  const closed = esc.state === "RESOLVED" || esc.state === "WITHDRAWN";

  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{esc.subject}</Body>
        <View style={{ marginLeft: space(2) }}>
          <Badge text={escalationStateLabel(esc.state)} tone={toneFor(esc.state)} />
        </View>
      </View>
      <Muted style={{ marginTop: 2 }}>
        {`${esc.bookId} · ${STR.sbLesson} ${bnNum(esc.lessonNo)} · ${esc.target}${esc.targetId ? ` (${esc.targetId})` : ""}`}
      </Muted>
      <Muted>{isoDateTimeLabel(esc.createdAt)}</Muted>

      <Divider />

      {esc.messages.map((m, i) => (
        <View key={`${esc.escalationId}-${i}`} style={{ paddingVertical: 4 }}>
          <Muted style={{ fontSize: 12 }}>{isoDateTimeLabel(m.createdAt)}</Muted>
          <Body style={{ fontSize: 14 }}>{m.body}</Body>
        </View>
      ))}

      {esc.resolution ? (
        <>
          <Divider />
          <Body style={{ fontWeight: "700" }}>{STR.sbResolution}</Body>
          <Body>{esc.resolution}</Body>
        </>
      ) : null}

      {!closed ? (
        <>
          <Divider />
          <Field label={STR.sbReply} value={reply} onChangeText={setReply} multiline autoCapitalize="sentences" />
          <Button
            title={STR.sbReply}
            variant="secondary"
            onPress={() => { void onReply(); }}
            loading={replyRes.fetching}
            disabled={!reply.trim() || replyRes.fetching}
            style={{ alignSelf: "flex-start", marginTop: space(2) }}
          />

          {canResolve ? (
            <>
              <Divider />
              {/* Said in words, right where the button is: closing a thread moves no
                  text in the book. The author still has to patch it (D-#410). */}
              <Muted style={{ marginBottom: 4 }}>{STR.sbResolvedNote}</Muted>
              <Field label={STR.sbResolution} value={ruling} onChangeText={setRuling} multiline autoCapitalize="sentences" />
              <Button
                title={STR.sbResolve}
                onPress={() => { void onResolve(); }}
                loading={resolveRes.fetching}
                disabled={!ruling.trim() || resolveRes.fetching}
                style={{ alignSelf: "flex-start", marginTop: space(2) }}
              />
            </>
          ) : null}
        </>
      ) : null}

      {note ? (
        <Muted style={{ marginTop: space(2), color: note.bad ? colors.error : colors.primary }}>
          {note.text}
        </Muted>
      ) : null}
    </Card>
  );
}

export default function BookEscalationInboxScreen(): React.ReactElement {
  const { can } = useAuth();
  const canResolve = can("book:review_senior");

  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });
  const books = booksQ.data?.supportBooks ?? [];
  // No book picked = every book. A senior reviewer covers the programme, not one title,
  // so "all" is the honest default rather than an arbitrary first book.
  const [bookId, setBookId] = useState<string | null>(null);
  const [openOnly, setOpenOnly] = useState(true);

  const [escQ, refetchEsc] = useQuery<{ supportBookEscalations: SupportBookEscalationT[] }>({
    query: SUPPORT_BOOK_ESCALATIONS,
    variables: { bookId: bookId ?? undefined, openOnly },
  });
  const threads = escQ.data?.supportBookEscalations ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbInboxTitle}</Body>
          <Muted>{STR.sbInboxSub}</Muted>
          <Select
            label={STR.sbBook}
            value={bookId}
            options={books.map((b) => ({ label: `${b.titleBn} (${b.bookId})`, value: b.bookId }))}
            onChange={(v) => setBookId(v)}
            placeholder={STR.sbAll}
          />
          <ChipRow>
            <Chip label={STR.sbOpenOnly} selected={openOnly} onPress={() => setOpenOnly(true)} />
            <Chip label={STR.sbAll} selected={!openOnly} onPress={() => setOpenOnly(false)} />
          </ChipRow>
        </Card>

        <View style={{ height: space(3) }} />

        <QueryGate
          results={[booksQ, escQ]}
          onRetry={() => {
            refetchBooks({ requestPolicy: "network-only" });
            refetchEsc({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          {threads.length === 0 ? (
            <EmptyState message={STR.sbInboxEmpty} />
          ) : (
            threads.map((e) => (
              <Thread
                key={e.escalationId}
                esc={e}
                canResolve={canResolve}
                onChanged={() => refetchEsc({ requestPolicy: "network-only" })}
              />
            ))
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
