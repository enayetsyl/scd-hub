/**
 * ViewAsScreen (VA-1, D-#638) — the Principal picks whose account view to open.
 *
 * Two tabs, because the two audiences are looked up differently: staff by name, families
 * by their child. A guardian row therefore leads with the শিক্ষার্থী's name and শাখা under
 * the guardian's own name (owner ask), and the search box matches a student name too.
 *
 * Ineligible rows are shown LOCKED rather than filtered away — a row that is simply
 * missing invites "why can't I find her", while a locked row with its reason answers it.
 * The server refuses these independently; this screen only avoids offering the door.
 */
import React, { useState } from "react";
import { ScrollView, View, Pressable } from "react-native";
import { useQuery } from "urql";
import { useNavigation } from "@react-navigation/native";
import { IMPERSONATION_TARGETS, type ImpersonationTargetT } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Field, Badge, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { STR } from "../../lib/labels";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

type Tab = "STAFF" | "GUARDIAN";

export default function ViewAsScreen(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("STAFF");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { startViewAs } = useAuth();
  const navigation = useNavigation();
  const colors = useColors();

  const [q] = useQuery({
    query: IMPERSONATION_TARGETS,
    variables: { kind: tab, search: search.trim() === "" ? null : search.trim() },
  });
  const rows = q.data?.impersonationTargets ?? [];

  const open = async (row: ImpersonationTargetT) => {
    if (!row.eligible || busyId) return;
    setBusyId(row.id);
    setError(null);
    const res = await startViewAs(row.id, row.kind);
    setBusyId(null);
    if (!res.ok) {
      setError(res.message ?? STR.viewAsFailed);
      return;
    }
    // The borrowed account renders its own tab set; go back to the app root and let the
    // remount land on that role's own initial route (G5).
    if (navigation.canGoBack()) navigation.goBack();
  };

  const Tabs = (): React.ReactElement => (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" }}>
      {(["STAFF", "GUARDIAN"] as Tab[]).map((t) => (
        <Pressable
          key={t}
          onPress={() => setTab(t)}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === t }}
          style={{
            flex: 1,
            paddingVertical: space(2),
            alignItems: "center",
            backgroundColor: tab === t ? colors.primaryContainer : colors.surface,
          }}
        >
          <Body style={{ fontWeight: tab === t ? "700" : "400" }}>
            {t === "STAFF" ? STR.viewAsStaffTab : STR.viewAsGuardianTab}
          </Body>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space(3), gap: space(3) }}>
        <Tabs />
        <Field label={STR.viewAsSearch} value={search} onChangeText={setSearch} />
        {error ? <ErrorBanner message={error} /> : null}
        {q.fetching ? <Loader /> : null}
        {!q.fetching && rows.length === 0 ? <EmptyState message={STR.viewAsEmpty} /> : null}

        {rows.map((row) => (
          <Pressable
            key={row.id}
            onPress={() => void open(row)}
            disabled={!row.eligible || busyId !== null}
            accessibilityRole="button"
            accessibilityState={{ disabled: !row.eligible }}
            style={{ opacity: row.eligible ? 1 : 0.55 }}
          >
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{row.name}</Body>
                <Badge text={row.role} tone={row.eligible ? "info" : "muted"} />
                {busyId === row.id ? <Muted>…</Muted> : null}
              </View>
              {/* Guardians: one line per child. Staff: their sections. */}
              {row.lines.map((line, i) => (
                <Muted key={i} style={{ marginTop: 2 }}>
                  {line}
                </Muted>
              ))}
              {row.reason ? <Muted style={{ marginTop: 2 }}>🔒 {row.reason}</Muted> : null}
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
