/**
 * GuardianNoticeScreen (M-6 app pass) — the guardian-notice composer. Surfaced
 * to `chat:write`; the SERVER enforces the D-#45 per-scope rule (SECTION → that
 * section's class teacher OR chat:manage; SCHOOL → chat:manage) and returns a
 * Bangla deny on violation, which we show inline. On success it renders the
 * returned recipients as tappable ADR-003 wa.me links (one per reachable
 * guardian) plus the reachable / unreachable counts. Guardians are recipients,
 * not chat participants (D-#76) — no login required. No server change.
 *
 * Section picker = `mySectionsAsClassTeacher` (the caller's coordinated sections,
 * the D-#45 primary author of a SECTION notice). SCHOOL scope (no section) is
 * offered only to chat:manage holders.
 *
 * APP-FU1: chat:manage holders (Principal/Office) get the FULL section picker —
 * academic-year → every class's sections via `classes` — so they can target an
 * arbitrary section, not just one they class-teach. The server already permits
 * this: `assertCanComposeNotice` bypasses `assertIsClassTeacher` for canManage,
 * so this is purely the missing picker UI. No server change.
 */
import React, { useState } from "react";
import { Linking, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  COMPOSE_GUARDIAN_NOTICE,
  MY_SECTIONS_AS_CLASS_TEACHER_QUERY,
  CLASSES_QUERY,
  type GuardianNoticeResultT,
  type SectionT,
} from "../../graphql/operations";
import type { ChatStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Chip, Field, Notice, Badge, Loader, Select } from "../../components/ui";
import { AcademicYearSelect } from "../../components/selects";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ChatStackParamList, "GuardianNotice">;

type Scope = "SECTION" | "SCHOOL";

export default function GuardianNoticeScreen(_props: Props): React.ReactElement {
  const { role, can } = useAuth();
  const canManage = can("chat:manage");

  const [scope, setScope] = useState<Scope>("SECTION");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [ayId, setAyId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuardianNoticeResultT | null>(null);

  // Class teachers pick from their coordinated sections; managers (Principal/
  // Office) get the full academic-year → all-sections picker below.
  const [sectionsQ] = useQuery({ query: MY_SECTIONS_AS_CLASS_TEACHER_QUERY, pause: canManage });
  const sections: SectionT[] = sectionsQ.data?.mySectionsAsClassTeacher ?? [];

  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: ayId || "" },
    pause: !canManage || !ayId,
  });
  const sectionOptions = (classesQ.data?.classes ?? []).flatMap((c) =>
    c.sections.map((s) => ({ label: `${c.nameBn} · ${s.nameBn} (${s.code})`, value: s.id })),
  );

  const [, compose] = useMutation(COMPOSE_GUARDIAN_NOTICE);

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    (scope === "SCHOOL" || !!sectionId) &&
    !busy;

  async function onSubmit(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await compose({
        scope,
        title: title.trim(),
        body: body.trim(),
        sectionId: scope === "SECTION" ? sectionId : null,
      });
      if (res.error) throw new Error(res.error.message.replace(/^\[\w+\]\s*/, ""));
      if (res.data?.composeGuardianNotice) setResult(res.data.composeGuardianNotice);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.chatActionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Notice message={STR.chatNoticeHint} tone="info" />

      {/* Scope */}
      <Card>
        <Muted>{STR.chatNoticeScope}</Muted>
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
          <Chip
            label={STR.chatNoticeScopeSection}
            selected={scope === "SECTION"}
            onPress={() => setScope("SECTION")}
          />
          {canManage ? (
            <Chip
              label={STR.chatNoticeScopeSchool}
              selected={scope === "SCHOOL"}
              onPress={() => setScope("SCHOOL")}
            />
          ) : null}
        </View>
      </Card>

      {/* Section picker (SECTION scope only) */}
      {scope === "SECTION" ? (
        <Card>
          <Muted>{STR.chatNoticePickSection}</Muted>
          {canManage ? (
            /* APP-FU1 — managers (Principal/Office): full academic-year → all-
               sections picker. Server authorizes the arbitrary-section notice. */
            <>
              <Muted style={{ marginTop: space(1) }}>{STR.chatNoticeManagerNote}</Muted>
              <View style={{ marginTop: space(2) }}>
                <AcademicYearSelect label={STR.academicYear} value={ayId} onChange={setAyId} />
              </View>
              {ayId ? (
                classesQ.fetching ? (
                  <Loader label={STR.loading} />
                ) : (
                  <Select
                    label={STR.chatNoticeSection}
                    value={sectionId}
                    options={sectionOptions}
                    onChange={setSectionId}
                    placeholder={STR.chatNoticePickSectionAny}
                    emptyText={STR.empty}
                  />
                )
              ) : null}
            </>
          ) : sectionsQ.fetching ? (
            <Loader label={STR.loading} />
          ) : sections.length === 0 ? (
            <Muted style={{ marginTop: space(1) }}>{STR.chatNoticeNoSections}</Muted>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
              {sections.map((s) => (
                <Chip
                  key={s.id}
                  label={s.nameBn}
                  selected={sectionId === s.id}
                  onPress={() => setSectionId(s.id)}
                />
              ))}
            </View>
          )}
        </Card>
      ) : null}

      {/* Title + body */}
      <Card>
        <Muted>{STR.chatNoticeTitleLabel}</Muted>
        <Field value={title} onChangeText={setTitle} placeholder={STR.chatNoticeTitlePlaceholder} />
        <Muted style={{ marginTop: space(2) }}>{STR.chatNoticeBodyLabel}</Muted>
        <Field
          value={body}
          onChangeText={setBody}
          placeholder={STR.chatNoticeBodyPlaceholder}
          multiline
          autoCapitalize="sentences"
        />
      </Card>

      <Button title={STR.chatNoticeSend} onPress={() => void onSubmit()} loading={busy} disabled={!canSubmit} />

      {error ? <Notice message={error} tone="danger" /> : null}

      {/* Result: counts + per-guardian wa.me links */}
      {result ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.chatNoticeSent}</Body>
          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
            <Badge text={`${STR.chatNoticeReachable}: ${bnNum(result.recipientCount)}`} tone="info" />
            {result.unreachableCount > 0 ? (
              <Badge text={`${STR.chatNoticeUnreachable}: ${bnNum(result.unreachableCount)}`} tone="muted" />
            ) : null}
          </View>

          <Muted style={{ marginTop: space(2) }}>{STR.chatNoticeRecipients}</Muted>
          {result.recipients.length === 0 ? (
            <Muted style={{ marginTop: space(1) }}>{STR.chatNoticeEmptyRecipients}</Muted>
          ) : (
            <View style={{ gap: space(1), marginTop: space(1) }}>
              {result.recipients.map((r) => (
                <Button
                  key={r.studentId}
                  title={`📲 ${r.studentName} — ${STR.chatNoticeOpenWa}`}
                  variant="secondary"
                  onPress={() => void Linking.openURL(r.waLink)}
                />
              ))}
            </View>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
