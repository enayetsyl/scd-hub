/**
 * MyLettersScreen (D-#903) — a staff member's OWN issued letters, newest first.
 *
 * Every letter the school issues to someone lands here, sent or not; sending it (D-#902)
 * is how they learn it is there — the notification and the pop-up both open this screen.
 * Void letters are left out: they were superseded, and the paper copy is matched from the
 * Office's side. The PDF opens on the web and in the phone's PDF viewer on Android.
 */
import React from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { MY_STAFF_LETTERS_QUERY } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Button, Divider, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, staffLetterKindLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openLetterPdf, LETTER_PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

export default function MyLettersScreen(): React.ReactElement {
  const [{ data, fetching, error }] = useQuery({ query: MY_STAFF_LETTERS_QUERY, requestPolicy: "cache-and-network" });
  const [failure, setFailure] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);
  const letters = data?.myStaffLetters ?? [];

  async function open(id: string): Promise<void> {
    setOpening(id);
    setFailure(null);
    try {
      await openLetterPdf(`/pdf/staff-letter/${id}`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    }
    setOpening(null);
  }

  return (
    <Screen scroll>
      <H2>{STR.hrMyLetters}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.hrMyLettersSub}</Muted>
      {failure ? <Notice tone="danger" message={failure} /> : null}
      <Card>
        {error ? (
          <Notice tone="danger" message={friendlyError(error)} />
        ) : fetching && letters.length === 0 ? (
          <Loader label={STR.loading} />
        ) : letters.length === 0 ? (
          <EmptyState message={STR.hrMyLettersEmpty} />
        ) : (
          letters.map((l, i) => (
            <View key={l.id}>
              {i > 0 ? <Divider /> : null}
              <Body style={{ fontWeight: "700" }}>{staffLetterKindLabel(l.kind)}</Body>
              <Muted>{`${l.refNo} · ${l.letterDate}`}</Muted>
              {LETTER_PDF_SUPPORTED ? (
                <View style={{ marginTop: space(1), alignItems: "flex-start" }}>
                  <Button
                    title={STR.stfViewPdf}
                    variant="secondary"
                    loading={opening === l.id}
                    disabled={opening !== null}
                    onPress={() => void open(l.id)}
                  />
                </View>
              ) : null}
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
