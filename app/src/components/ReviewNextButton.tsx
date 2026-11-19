/**
 * ReviewNextButton - "পরের কাজ ▶" (.claude/plans/review-next-chunk.md).
 *
 * Reads the caller's ordered review path fresh and opens the first undecided item: the next plan, or
 * the next chapter's question queue. When nothing is left it says so instead. PUSH keeps the current
 * screen on the Back path (hub / chapter); REPLACE swaps it out (the queue that just ran empty).
 */
import React, { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useClient } from "urql";
import { Button, Notice } from "./ui";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { fetchNextItem, openItemAction } from "../lib/reviewPath";

export function ReviewNextButton({ mode = "push" }: { mode?: "push" | "replace" }): React.ReactElement {
  const nav = useNavigation();
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);

  async function onPress(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await fetchNextItem(client);
    setBusy(false);
    if (res.error) setMessage({ text: friendlyError(res.error), tone: "danger" });
    else if (res.item) nav.dispatch(openItemAction(res.item, mode));
    else setMessage({ text: STR.rpAllDone, tone: "ok" });
  }

  return (
    <>
      <Button title={STR.rpNext} onPress={() => void onPress()} loading={busy} />
      {message ? <Notice message={message.text} tone={message.tone} /> : null}
    </>
  );
}
