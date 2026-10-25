/**
 * GuardianMeetingCard (D-#841) — the family's parents'-meeting time and the state of
 * its answer on the guardian Home: confirmed / change awaiting approval / approved
 * (shows the new time) / declined (original time stays) / can't come.
 *
 * Its own query, mounted OUTSIDE the Home QueryGate so an empty or failed meeting read
 * never hides the rest of Home (and vice versa). Renders nothing when there is no
 * upcoming dispatched meeting. Unanswered slots are the popup's job; the card still
 * lists them so the time is visible.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { MY_MEETING_SLOTS_QUERY } from "../graphql/comments";
import { Badge, Body, Card, Muted } from "./ui";
import { STR, fullDateLabel, minutesToHHMM } from "../lib/labels";
import { rsvpStatus } from "../lib/meetingRsvp";
import { space } from "../theme/tokens";

export function GuardianMeetingCard(): React.ReactElement | null {
  const [result] = useQuery({ query: MY_MEETING_SLOTS_QUERY });
  const asks = result.data?.myMeetingSlots ?? [];
  if (result.error || asks.length === 0) return null;

  return (
    <>
      {asks.map((a) => {
        const st = rsvpStatus(a.response);
        return (
          <Card key={a.slotId}>
            <Body style={{ fontWeight: "700" }}>
              {STR.rsTitle} — {a.instanceLabel}
            </Body>
            {/* Its own line: the longer states ("not possible — the time stays") do not fit
                beside the title at phone width. */}
            <View style={{ flexDirection: "row", marginTop: space(1) }}>
              <Badge text={st.text} tone={st.tone} />
            </View>
            <Muted style={{ marginTop: space(1) }}>
              {fullDateLabel(a.meetingDate.slice(0, 10))} · {STR.rsYourTime}:{" "}
              {a.onCall ? STR.cmOnCall : minutesToHHMM(a.slotTime)}
            </Muted>
            {a.childNames.length > 0 ? <Muted>{a.childNames.join(", ")}</Muted> : null}
            {a.response?.choice === "CHANGE_REQUESTED" && !a.response.reviewOutcome ? (
              <Muted>
                {STR.rsWanted}: {minutesToHHMM(a.response.preferredSlotTime)}
              </Muted>
            ) : null}
            {a.response?.reviewNote ? <Muted>{a.response.reviewNote}</Muted> : null}
          </Card>
        );
      })}
    </>
  );
}
