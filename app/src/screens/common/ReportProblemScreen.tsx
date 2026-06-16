/**
 * "Report a problem" (MON-3, prd-observability.md §4) — a root-modal screen any
 * authenticated user can open from the header. Sends a Sentry user-feedback event
 * (current role + screen tag) to the self-hosted GlitchTip. A no-op-with-notice when
 * reporting is disabled (no `EXPO_PUBLIC_SENTRY_DSN`).
 */
import React from "react";
import { View, Text, TextInput } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Screen, Button } from "../../components/ui";
import { useColors, typeScale, fonts } from "../../theme";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { reportProblem, sentryEnabled } from "../../observability/sentry";

export default function ReportProblemScreen(): React.ReactElement {
  const navigation = useNavigation();
  const colors = useColors();
  const { role } = useAuth();
  const [text, setText] = React.useState("");
  const [sent, setSent] = React.useState(false);

  const onSend = () => {
    const ok = reportProblem(text.trim() || "(no description)", {
      role: role ?? "unknown",
      screen: "report-modal",
    });
    setSent(ok);
    if (ok) setTimeout(() => navigation.goBack(), 1200);
  };

  if (!sentryEnabled) {
    return (
      <Screen>
        <Text style={{ ...typeScale.body, color: colors.textPrimary }}>{STR.reportUnavailable}</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={{ ...typeScale.body, color: colors.textSecondary, marginBottom: 12 }}>
        {STR.reportHint}
      </Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        editable={!sent}
        placeholder={STR.reportHint}
        placeholderTextColor={colors.textDisabled}
        style={{
          minHeight: 120,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          padding: 12,
          color: colors.textPrimary,
          textAlignVertical: "top",
          fontFamily: fonts.regular,
          marginBottom: 16,
        }}
      />
      {sent ? (
        <View>
          <Text style={{ ...typeScale.body, color: colors.primary }}>{STR.reportSent}</Text>
        </View>
      ) : (
        <Button title={STR.reportSend} onPress={onSend} />
      )}
    </Screen>
  );
}
