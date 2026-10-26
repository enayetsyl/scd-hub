/**
 * MeetingBriefScreen (MC-4, docs/prd-meeting-comments.md §3/§4, D-#754/#755) — what the
 * person meeting a guardian reads, one child at a time (a tab per child of the family slot):
 *
 *   - the Principal's / Office's comment first, big;
 *   - the class teacher's summary on tap, then each subject teacher on tap;
 *   - beside it, the numbers since the last meeting, each tile opening to its detail;
 *   - Print: this child or the whole slot, with or without the subject comments and the
 *     details → the A4 PDF (/pdf/meeting-brief).
 *
 * Gate (server): roster:manage, or the class teacher of the child's section.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MEETING_BRIEF } from "../../graphql/meetingChain";
import { Body, Button, Card, Chip, ChipRow, Loader, Muted, Notice, Screen } from "../../components/ui";
import { Expander, NumbersTiles, TwoBoxes, dayLabel, finalSourceLabel, placeLabel } from "../../components/MeetingChainParts";
import { STR, minutesToHHMM, routineSubjectLabel } from "../../lib/labels";
import { openPdf } from "../../lib/pdf";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingBrief">;

/** A sibling tab's label: its own brief query, cached by urql and shared with the body. */
function KidTab({ meetingId, studentId, selected, onPress }: { meetingId: string; studentId: string; selected: boolean; onPress: () => void }): React.ReactElement {
  const [q] = useQuery({ query: MEETING_BRIEF, variables: { meetingId, studentId } });
  const b = q.data?.meetingBrief;
  return <Chip label={b ? `${b.studentName} · ${placeLabel(b)}` : "…"} selected={selected} onPress={onPress} />;
}

export default function MeetingBriefScreen({ route }: Props): React.ReactElement {
  const { meetingId, studentIds } = route.params;
  const c = useColors();
  const [kid, setKid] = React.useState(route.params.studentId ?? studentIds[0]);
  const [q] = useQuery({ query: MEETING_BRIEF, variables: { meetingId, studentId: kid }, requestPolicy: "cache-and-network" });
  const [ctOpen, setCtOpen] = React.useState(false);
  const [subjOpen, setSubjOpen] = React.useState(false);
  const [rowOpen, setRowOpen] = React.useState<string | null>(null);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [family, setFamily] = React.useState(false);
  const [incSubjects, setIncSubjects] = React.useState(true);
  const [incDetails, setIncDetails] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const b = q.data?.meetingBrief && q.data.meetingBrief.studentId === kid ? q.data.meetingBrief : null;

  async function onPrint(): Promise<void> {
    setErr(null);
    setPrinting(true);
    try {
      const ids = family ? studentIds : [kid];
      await openPdf(`/pdf/meeting-brief/${meetingId}?students=${ids.join(",")}&subjects=${incSubjects ? 1 : 0}&details=${incDetails ? 1 : 0}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
            <View>
              <Body style={{ fontWeight: "700", fontSize: 22 }}>{b ? (b.slotTime != null ? minutesToHHMM(b.slotTime) : b.onCall ? STR.cmOnCall : "—") : "…"}</Body>
              {b ? <Muted>{b.instanceLabel} · {dayLabel(b.meetingDateKey)}</Muted> : null}
            </View>
            <Button title={STR.mcPrint} variant="secondary" onPress={() => setPrintOpen(!printOpen)} />
          </View>
          {studentIds.length > 1 ? (
            <View style={{ marginTop: space(2) }}>
              <ChipRow>
                {studentIds.map((id) => (
                  <KidTab key={id} meetingId={meetingId} studentId={id} selected={id === kid} onPress={() => { setKid(id); setCtOpen(false); setSubjOpen(false); setRowOpen(null); }} />
                ))}
              </ChipRow>
            </View>
          ) : null}
        </Card>

        {printOpen ? (
          <Card style={{ borderWidth: 1, borderColor: c.info }}>
            <Body style={{ fontWeight: "700" }}>{STR.mcWhatToPrint}</Body>
            {studentIds.length > 1 ? (
              <ChipRow>
                <Chip label={STR.mcThisChild} selected={!family} onPress={() => setFamily(false)} />
                <Chip label={STR.mcWholeFamily} selected={family} onPress={() => setFamily(true)} />
              </ChipRow>
            ) : null}
            <Muted>{STR.mcAlwaysIncluded}</Muted>
            <ChipRow>
              <Chip label={`${incSubjects ? "✓ " : ""}${STR.mcIncludeSubjects}`} selected={incSubjects} onPress={() => setIncSubjects(!incSubjects)} />
              <Chip label={`${incDetails ? "✓ " : ""}${STR.mcIncludeDetails}`} selected={incDetails} onPress={() => setIncDetails(!incDetails)} />
            </ChipRow>
            {err ? <Notice message={err} tone="danger" /> : null}
            <Button title={STR.mcMakePdf} onPress={() => void onPrint()} loading={printing} style={{ marginTop: space(2) }} />
          </Card>
        ) : null}

        {!b ? (
          q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(4), alignItems: "flex-start" }}>
            <View style={{ flexGrow: 999, flexShrink: 1, flexBasis: 480, minWidth: 0, gap: space(3) }}>
              <View>
                <Body style={{ fontWeight: "700", fontSize: 24 }}>{b.studentName}</Body>
                <Muted>
                  {placeLabel(b)}
                  {b.classTeacherName ? ` · ${STR.mcClassTeacher} ${b.classTeacherName}` : ""}
                </Muted>
              </View>

              <Card style={{ borderWidth: 2, borderColor: c.gold }}>
                <Muted>
                  {STR.mcPrincipalComment}
                  {b.final ? ` · ${finalSourceLabel(b.final.source)}` : ""}
                </Muted>
                <View style={{ marginTop: space(2) }}>
                  {b.final ? <TwoBoxes strengths={b.final.strengths} concerns={b.final.concerns} big /> : <Muted>{STR.mcNotWrittenYet}</Muted>}
                </View>
              </Card>

              <Card>
                <Expander title={STR.mcCtSummary} subtitle={b.summary?.authorName ?? null} open={ctOpen} onToggle={() => setCtOpen(!ctOpen)}>
                  {b.summary ? <TwoBoxes strengths={b.summary.strengths} concerns={b.summary.concerns} /> : <Muted>{STR.mcNotWrittenYet}</Muted>}
                </Expander>
              </Card>

              <Card>
                <Expander title={`${STR.mcSubjectTeachers} (${b.subjectNotes.filter((s) => s.written).length})`} open={subjOpen} onToggle={() => setSubjOpen(!subjOpen)}>
                  {b.subjectNotes.map((s) => (
                    <View key={s.subject} style={{ borderTopWidth: 1, borderTopColor: c.surfaceAlt }}>
                      <Expander
                        title={`${routineSubjectLabel(s.subject)}${s.teacherName ? ` · ${s.teacherName}` : ""}`}
                        subtitle={s.skipped ? STR.mcSkipped : !s.written ? STR.mcNotWrittenYet : null}
                        open={rowOpen === s.subject}
                        onToggle={() => setRowOpen(rowOpen === s.subject ? null : s.subject)}
                      >
                        {s.written ? <TwoBoxes strengths={s.strengths} concerns={s.concerns} /> : <Muted>{STR.mcNotWrittenYet}</Muted>}
                      </Expander>
                    </View>
                  ))}
                </Expander>
              </Card>
            </View>

            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 320, minWidth: 0, gap: space(2) }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(2), flexWrap: "wrap" }}>
                <Body style={{ fontWeight: "700" }}>{STR.mcSinceLast}</Body>
                <Muted>
                  {dayLabel(b.numbers.fromKey)} – {dayLabel(b.numbers.toKey)}
                </Muted>
              </View>
              <NumbersTiles numbers={b.numbers} classBest={b.classBest} />
              {b.classBest?.withheld ? <Muted>{STR.mcSectionBestWithheld}</Muted> : null}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
