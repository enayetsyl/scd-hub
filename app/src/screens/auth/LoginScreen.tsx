/**
 * LoginScreen (S1 / J5.1) — staff email + password → staffLogin → JWT stored →
 * AuthContext flips to authed, RootNavigator swaps to the tabs. Invalid
 * credentials surface a Bangla error.
 */
import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Screen, H1, Muted, Field, Button, Notice } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useLanguage } from "../../state/LanguageContext";
import { STR } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

export default function LoginScreen(): React.ReactElement {
  const { login } = useAuth();
  const colors = useColors();
  const { lang, toggle } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await login(email, password);
    if (!res.ok) setError(res.message ?? STR.loginInvalid);
    setBusy(false);
  }

  return (
    <Screen scroll>
      <View style={{ alignItems: "flex-end", marginTop: space(4) }}>
        <Pressable onPress={toggle} hitSlop={12} accessibilityLabel={STR.language}>
          <Text style={{ ...typeScale.button, color: colors.primary }}>{lang === "bn" ? "English" : "বাংলা"}</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: space(8), marginBottom: space(6) }}>
        <H1>{STR.appName}</H1>
        <Muted>{STR.appSub}</Muted>
      </View>

      {error ? <Notice message={error} tone="danger" /> : null}

      <Field
        label={STR.emailOrPhone}
        value={email}
        onChangeText={setEmail}
        placeholder="you@school.edu / 01XXXXXXXXX"
        keyboardType="email-address"
        autoComplete="username"
        returnKeyType="next"
        onSubmitEditing={onSubmit}
      />
      <Field
        label={STR.password}
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />

      <Button
        title={busy ? STR.loggingIn : STR.login}
        onPress={onSubmit}
        loading={busy}
        style={{ marginTop: space(2) }}
      />
    </Screen>
  );
}
