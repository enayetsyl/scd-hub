/**
 * AiProjectFileTextScreen (AI Workspace W-1) — the text the AI sees for one file, 20,000
 * characters at a time, so the person can check how a scan or a picture was read.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AI_PROJECT_FILE_TEXT } from "../../graphql/aiWorkspace";
import type { AiWorkspaceStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Loader, ErrorBanner, breakAnywhere } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { fill } from "./aiWorkspaceUi";

type Props = NativeStackScreenProps<AiWorkspaceStackParamList, "AiProjectFileText">;
const CHUNK = 20_000;

export default function AiProjectFileTextScreen({ route, navigation }: Props): React.ReactElement {
  const { fileId } = route.params;
  const [offset, setOffset] = React.useState(0);
  const [q] = useQuery({ query: AI_PROJECT_FILE_TEXT, variables: { fileId, offset, limit: CHUNK } });
  const d = q.data?.aiProjectFileText;
  React.useEffect(() => {
    if (d) navigation.setOptions({ title: d.name });
  }, [d, navigation]);
  if (q.fetching && !d) return <Screen><Loader /></Screen>;
  if (q.error || !d) return <Screen><ErrorBanner message={friendlyError(q.error as never)} /></Screen>;
  const to = Math.min(d.totalChars, d.offset + d.text.length);
  return (
    <Screen scroll>
      <Muted>{fill(STR.awTextOf, { from: d.offset + 1, to, total: d.totalChars })}</Muted>
      <Card>
        <Body style={breakAnywhere}>
          {d.text}
        </Body>
      </Card>
      <View style={{ flexDirection: "row", gap: space(1) }}>
        <Button title={STR.awPrev} variant="secondary" disabled={d.offset === 0} onPress={() => setOffset(Math.max(0, d.offset - CHUNK))} />
        <Button title={STR.awNext} variant="secondary" disabled={to >= d.totalChars} onPress={() => setOffset(to)} />
      </View>
    </Screen>
  );
}
