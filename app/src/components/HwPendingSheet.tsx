/**
 * HwPendingSheet (D-#350) — the drill-down behind a pending number on the
 * homework lifecycle report. Given a teacher + pending stage (and the report's
 * active date/class/subject filters), it lists the named students stuck at that
 * stage with roll, class·subject·section, the primary guardian phone (tap to
 * call), current state, and days waiting. Same Modal scaffold as FilterSheet.
 */
import React from "react";
import { Linking, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "urql";
import { HW_LIFECYCLE_PENDING_QUERY, type HwPendingStage } from "../graphql/operations";
import { Body, Button, H2, Muted, Loader, ErrorBanner } from "./ui";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, getActiveLang } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { makeStyles, radius, space } from "../theme";

export interface HwPendingTarget {
  teacherId: string;
  teacherName: string;
  stage: HwPendingStage;
  stageLabel: string;
}

export function HwPendingSheet({
  visible,
  target,
  from,
  to,
  classLevel,
  subject,
  onClose,
}: {
  visible: boolean;
  target: HwPendingTarget | null;
  from: string;
  to: string;
  classLevel: number | null;
  subject: string | null;
  onClose: () => void;
}): React.ReactElement {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const lang = getActiveLang();

  const [q] = useQuery({
    query: HW_LIFECYCLE_PENDING_QUERY,
    variables: {
      from,
      to,
      teacherId: target?.teacherId ?? "",
      stage: (target?.stage ?? "SUBMISSION") as HwPendingStage,
      classLevel,
      subject,
    },
    pause: !visible || !target,
    requestPolicy: "cache-and-network",
  });
  const rows = q.data?.homeworkLifecyclePending ?? [];

  const call = (phone: string): void => {
    Linking.openURL(`tel:${phone}`).catch(() => undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={STR.close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space(4) }]}>
          <View style={styles.handle} />
          <H2>{target?.stageLabel ?? STR.hlrPendingHeader}</H2>
          {target ? <Muted>{target.teacherName}</Muted> : null}

          {q.error ? <ErrorBanner message={friendlyError(q.error)} /> : null}
          {q.fetching && rows.length === 0 ? <Loader label={STR.loading} /> : null}
          {!q.fetching && rows.length === 0 && !q.error ? (
            <Muted style={{ marginTop: space(2) }}>{STR.hlrNoPending}</Muted>
          ) : null}

          <ScrollView style={styles.scroll}>
            {rows.map((s) => (
              <View key={s.studentId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: "600" }}>
                    {lang === "en" ? s.name : s.nameBn || s.name}
                    {s.rollNumber ? <Muted>{`  ${STR.hlrRoll} ${bnNum(s.rollNumber)}`}</Muted> : null}
                  </Body>
                  <Muted>
                    {classLevelLabel(s.classLevel)}
                    {s.subject ? ` · ${hwSubjectLabel(s.subject)}` : ""}
                    {s.sectionNameBn ? ` · ${s.sectionNameBn}` : ""}
                  </Muted>
                  {s.guardianPhone ? (
                    <Pressable onPress={() => call(s.guardianPhone!)} hitSlop={6}>
                      <Muted style={styles.phone}>📞 {s.guardianPhone}</Muted>
                    </Pressable>
                  ) : (
                    <Muted>{STR.hlrNoPhone}</Muted>
                  )}
                </View>
                <View style={styles.wait}>
                  <Body style={{ fontWeight: "700" }}>
                    {bnNum(s.daysWaiting)} {STR.hlrDays}
                  </Body>
                  <Muted>{STR.hlrWaiting}</Muted>
                  {s.chaseCount > 0 ? (
                    <Muted>
                      {STR.hlrChases} {bnNum(s.chaseCount)}
                    </Muted>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>

          <Button title={STR.close} variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdropWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(4),
    gap: space(2),
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    maxHeight: "88%",
  },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border, alignSelf: "center" },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2),
    paddingVertical: space(2),
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  phone: { color: colors.primary, marginTop: 2 },
  wait: { alignItems: "flex-end", minWidth: 64 },
}));
