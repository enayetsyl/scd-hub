/**
 * AssignmentBankPicker (AL-8, PRD §4.3 / §4.6) — "ব্যাংক থেকে বেছে নিন": the bank questions a teacher may ADD to a weekly
 * assignment draft (the common part, or one student's Part B). The server has already applied the §4.3 exclusions — a
 * homework question of the year, anything used inside the no-repeat window, a question already on the sheet are not
 * listed — and lists questions the শাখা / student had before the window last, flagged "আবার". A text filter narrows the
 * list; the typed-code field stays as a fallback. A server refusal on add is shown by the caller as worded.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { ASSIGNMENT_ADD_CANDIDATES_QUERY, type AssignmentAddCandidate } from "../graphql/mastery";
import { Badge, Body, Button, Card, Field, Loader, Muted, Notice } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space } from "../theme";

export function AssignmentBankPicker({
  assignmentId,
  studentId,
  disabled,
  onAdd,
}: {
  assignmentId: string;
  /** Null / absent = the common part (Part A). */
  studentId?: string | null;
  disabled?: boolean;
  /** Add one question by its code; resolves true when it was added. */
  onAdd: (qid: string) => Promise<boolean>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilter(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: ASSIGNMENT_ADD_CANDIDATES_QUERY,
    variables: { assignmentId, studentId: studentId ?? null, filter: filter || null },
    pause: !open,
    requestPolicy: "network-only",
  });
  const rows = (data?.assignmentAddCandidates ?? []) as AssignmentAddCandidate[];
  const add = async (qid: string): Promise<boolean> => {
    const ok = await onAdd(qid);
    if (ok) refetch({ requestPolicy: "network-only" });
    return ok;
  };

  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.al8AddBank}</Body>
      <Button title={open ? STR.al8PickHide : STR.al8PickBank} variant="secondary" onPress={() => setOpen((v) => !v)} />
      {open ? (
        <View style={{ gap: space(2) }}>
          <Field label={STR.al8PickSearch} value={text} onChangeText={setText} />
          {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
          {fetching && rows.length === 0 ? <Loader /> : null}
          {!fetching && !error && rows.length === 0 ? <Muted>{STR.al8PickNone}</Muted> : null}
          {rows.map((c) => (
            <View key={c.qid} style={{ gap: space(1), paddingVertical: space(1) }}>
              <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center" }}>
                <Badge text={`${c.questionTypeCode} · ${bnNum(c.marks)}`} tone="muted" />
                {c.repeat ? <Badge text={STR.al8Again} tone="warn" /> : null}
              </View>
              <Body>{c.textBn ?? c.qid}</Body>
              <Muted style={{ fontSize: 12 }}>
                {c.loCode} · {c.labelBn} · {c.qid}
              </Muted>
              <Button title={STR.al8AddBankBtn} variant="secondary" disabled={disabled} onPress={() => void add(c.qid)} />
            </View>
          ))}
        </View>
      ) : null}
      <Field label={STR.al8PickTypeCode} value={code} onChangeText={setCode} />
      <Button
        title={STR.al8AddBankBtn}
        variant="secondary"
        disabled={disabled || !code.trim()}
        onPress={async () => {
          if (await add(code.trim())) setCode("");
        }}
      />
    </Card>
  );
}
