/**
 * Shared pieces of the objective-tree review screens (OT-2, prd-objective-tree §7):
 * state words + badge tones, the queue query hook, the one mutation runner every action uses,
 * and the comment-thread block (row detail + the round's own comments).
 *
 * Level words always come from useMasteryLevelLabels (D-#923) — never a literal here.
 */
import React, { useState } from "react";
import { Pressable, View, type StyleProp, type TextStyle } from "react-native";
import { useMutation, useQuery, type AnyVariables, type TypedDocumentNode } from "urql";
import type { DocumentNode } from "graphql";
import {
  MASTERY_REVIEW_COMMENT,
  MASTERY_REVIEW_QUEUE_QUERY,
  type ReviewQueue,
  type ReviewThread,
} from "../../graphql/masteryReview";
import { Body, Muted, Badge, Button, Field, Notice } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";

type Tone = "brand" | "ok" | "warn" | "danger" | "muted" | "info" | "gold";

export function reviewStateLabel(s: string | null): string {
  switch (s) {
    case "PROPOSED":
      return STR.msRvRsProposed;
    case "ACCEPTED":
      return STR.msRvRsAccepted;
    case "EDITED":
      return STR.msRvRsEdited;
    case "REJECTED":
      return STR.msRvRsRejected;
    case "ADDED":
      return STR.msRvRsAdded;
    default:
      return s ?? "";
  }
}

export function reviewStateTone(s: string | null): Tone {
  if (s === "ACCEPTED" || s === "EDITED") return "ok";
  if (s === "ADDED") return "info";
  if (s === "REJECTED") return "danger";
  return "gold";
}

export function roundStateLabel(s: string): string {
  if (s === "OPEN") return STR.msRvStateOpen;
  if (s === "SUBMITTED") return STR.msRvStateSubmitted;
  if (s === "LOCKED") return STR.msRvStateLocked;
  return STR.msRvStateSuperseded;
}

export function roundStateTone(s: string): Tone {
  if (s === "OPEN") return "gold";
  if (s === "SUBMITTED") return "info";
  if (s === "LOCKED") return "ok";
  return "muted";
}

/** "LO-C1-MATH-07-03.2" → "07-03.2"; "LO-C1-MATH-SK-COL-01" → "COL-01". */
export const codeTail = (code: string): string => code.replace(/^LO-[A-Z0-9]+-[A-Z]+-(SK-)?/, "");

/** Tappable body text (opens a row). */
export function TapText({ onPress, children, style }: { onPress: () => void; children: React.ReactNode; style?: StyleProp<TextStyle> }): React.ReactElement {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={{ flexShrink: 1 }}>
      <Body style={style}>{children}</Body>
    </Pressable>
  );
}

export function useReviewQueue(reviewId: string): {
  queue: ReviewQueue | null;
  fetching: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MASTERY_REVIEW_QUEUE_QUERY,
    variables: { reviewId },
    requestPolicy: "cache-and-network",
  });
  return {
    queue: (data?.masteryReviewQueue as ReviewQueue | undefined) ?? null,
    fetching,
    error: error ? friendlyError(error) : null,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

/**
 * Run a review mutation: returns true on success (and toasts `okText`), keeps the refusal text
 * (the server names the broken tree rule) in `error` for the screen to show.
 */
export function useReviewAction<V extends AnyVariables>(
  doc: DocumentNode | TypedDocumentNode<unknown, V>,
): { run: (vars: V, okText?: string) => Promise<boolean>; busy: boolean; error: string | null; clear: () => void } {
  const toast = useToast();
  const [state, exec] = useMutation(doc as DocumentNode);
  const [error, setError] = useState<string | null>(null);
  return {
    busy: state.fetching,
    error,
    clear: () => setError(null),
    run: async (vars: V, okText?: string) => {
      setError(null);
      const res = await exec(vars as AnyVariables);
      if (res.error) {
        setError(friendlyError(res.error));
        return false;
      }
      if (okText) toast.show(okText);
      return true;
    },
  };
}

const ACTION_WORD: Record<string, string> = {
  REPLY: STR.msRvActReply,
  RESOLVE: STR.msRvActResolve,
  REOPEN: STR.msRvActReopen,
};

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
};

function ThreadBlock({ t, reviewId, canComment }: { t: ReviewThread; reviewId: string; canComment: boolean }): React.ReactElement {
  const [reply, setReply] = useState("");
  const act = useReviewAction(MASTERY_REVIEW_COMMENT);
  return (
    <View style={{ gap: space(1), paddingVertical: space(1) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
        <Muted>
          {t.byName} · {when(t.at)}
        </Muted>
        <Badge text={t.open ? STR.msRvThreadOpen : STR.msRvThreadResolved} tone={t.open ? "warn" : "ok"} />
      </View>
      <Body>{t.text}</Body>
      {t.replies.map((r) => (
        <View key={r.id} style={{ paddingLeft: space(3), gap: space(0.5) }}>
          <Muted>
            {ACTION_WORD[r.action] ?? r.action} · {r.byName} · {when(r.at)}
          </Muted>
          {r.text ? <Body>{r.text}</Body> : null}
        </View>
      ))}
      {canComment ? (
        <View style={{ gap: space(1) }}>
          {t.open ? (
            <Field value={reply} onChangeText={setReply} placeholder={STR.msRvReplyPh} multiline />
          ) : null}
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            {t.open ? (
              <Button
                title={STR.msRvReply}
                variant="secondary"
                disabled={!reply.trim()}
                loading={act.busy}
                onPress={() =>
                  void act.run({ reviewId, action: "REPLY", parentEventId: t.id, text: reply }).then((ok) => ok && setReply(""))
                }
              />
            ) : null}
            <Button
              title={t.open ? STR.msRvResolve : STR.msRvReopenThread}
              variant="ghost"
              loading={act.busy}
              onPress={() => void act.run({ reviewId, action: t.open ? "RESOLVE" : "REOPEN", parentEventId: t.id })}
            />
          </View>
        </View>
      ) : null}
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </View>
  );
}

/** Threads about one row (`code`) or the whole list (`code` null), plus a new-comment box. */
export function ReviewThreads({
  queue,
  code,
  title,
}: {
  queue: ReviewQueue;
  code: string | null;
  title: string;
}): React.ReactElement {
  const [text, setText] = useState("");
  const act = useReviewAction(MASTERY_REVIEW_COMMENT);
  const threads = queue.threads.filter((t) => (t.code ?? null) === code);
  return (
    <View style={{ gap: space(2) }}>
      <Body style={{ fontWeight: "700" }}>{title}</Body>
      {threads.length === 0 ? <Muted>{STR.msRvNoThreads}</Muted> : null}
      {threads.map((t) => (
        <ThreadBlock key={t.id} t={t} reviewId={queue.id} canComment={queue.canComment} />
      ))}
      {queue.canComment ? (
        <View style={{ gap: space(1) }}>
          <Field value={text} onChangeText={setText} placeholder={STR.msRvCommentPh} multiline />
          <Button
            title={STR.msRvSend}
            variant="secondary"
            disabled={!text.trim()}
            loading={act.busy}
            onPress={() => void act.run({ reviewId: queue.id, action: "COMMENT", code, text }).then((ok) => ok && setText(""))}
          />
        </View>
      ) : null}
      {act.error ? <Notice message={act.error} tone="danger" /> : null}
    </View>
  );
}
