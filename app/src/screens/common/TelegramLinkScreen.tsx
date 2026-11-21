/**
 * Telegram bot card (TB-1, D-#1666) — link / unlink the caller's Telegram chat so they can report
 * app problems with screenshots + voice notes. Reached from the 👤 account menu. Server: myTelegramLink,
 * createTelegramLink (one-time t.me deep link, 15 min), unlinkTelegram. Wraps at 360 dp.
 */
import React from "react";
import { AppState, Linking, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useMutation, useQuery } from "urql";
import { Button, Card, Screen } from "../../components/ui";
import { useColors, typeScale } from "../../theme";
import { STR } from "../../lib/labels";
import { CREATE_TELEGRAM_LINK, MY_TELEGRAM_LINK, UNLINK_TELEGRAM } from "../../graphql/operations";

export default function TelegramLinkScreen(): React.ReactElement {
  const colors = useColors();
  const [{ data, fetching }, refetch] = useQuery({ query: MY_TELEGRAM_LINK, requestPolicy: "network-only" });
  const [{ fetching: linking }, createLink] = useMutation(CREATE_TELEGRAM_LINK);
  const [{ fetching: unlinking }, unlink] = useMutation(UNLINK_TELEGRAM);
  const [message, setMessage] = React.useState<string | null>(null);
  const link = data?.myTelegramLink;

  // After tapping Start in Telegram the person comes back to the app: refresh on focus and on foreground.
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
      const sub = AppState.addEventListener("change", (st) => {
        if (st === "active") refetch({ requestPolicy: "network-only" });
      });
      return () => sub.remove();
    }, [refetch]),
  );

  const connect = async () => {
    setMessage(null);
    const res = await createLink({});
    if (res.error || !res.data) {
      setMessage(res.error?.graphQLErrors[0]?.message || STR.tgFailed);
      return;
    }
    setMessage(STR.tgLinkHint);
    void Linking.openURL(res.data.createTelegramLink.url);
  };

  const disconnect = async () => {
    setMessage(null);
    const res = await unlink({});
    if (res.error) setMessage(STR.tgFailed);
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <Screen scroll>
      <Card>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flexShrink: 1 }}>{STR.tgTitle}</Text>
        <Text style={{ ...typeScale.body, color: colors.textSecondary, marginTop: 8, flexShrink: 1 }}>{STR.tgIntro}</Text>
        {link && !link.available ? (
          <Text style={{ ...typeScale.body, color: colors.textSecondary, marginTop: 12 }}>{STR.tgOff}</Text>
        ) : (
          <View style={{ marginTop: 12, gap: 12 }}>
            <Text style={{ ...typeScale.bodyStrong, color: link?.linked ? colors.success : colors.textSecondary }}>
              {fetching && !link ? "…" : link?.linked ? `${STR.tgLinked}${link.tgUsername ? ` (@${link.tgUsername})` : ""}` : STR.tgNotLinked}
            </Text>
            {link?.linked ? (
              <Button title={STR.tgDisconnect} variant="secondary" onPress={() => void disconnect()} loading={unlinking} />
            ) : (
              <Button title={STR.tgConnect} onPress={() => void connect()} loading={linking} disabled={!link} />
            )}
          </View>
        )}
        {message ? <Text style={{ ...typeScale.body, color: colors.textSecondary, marginTop: 12, flexShrink: 1 }}>{message}</Text> : null}
      </Card>
    </Screen>
  );
}
