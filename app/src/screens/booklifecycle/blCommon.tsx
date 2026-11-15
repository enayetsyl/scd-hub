/**
 * Small shared pieces for the book-lifecycle screens (S1–S13).
 */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { Notice } from "../../components/ui";
import { space, typeScale, useColors } from "../../theme";
import { bnNum } from "../../lib/labels";

export function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  const colors = useColors();
  return <Text style={{ ...typeScale.sectionTitle, color: colors.textPrimary, marginTop: space(4), marginBottom: space(2) }}>{children}</Text>;
}

export function Line({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginBottom: space(1) }}>
      <Text style={{ ...typeScale.body, color: colors.textSecondary }}>{label}:</Text>
      <Text style={{ ...typeScale.body, color: colors.textPrimary, flexShrink: 1 }}>{value}</Text>
    </View>
  );
}

export type Msg = { tone: "ok" | "danger" | "warn" | "info"; text: string } | null;
export function useMsg(): [React.ReactElement | null, (m: Msg) => void] {
  const [msg, setMsg] = useState<Msg>(null);
  return [msg ? <Notice key="msg" tone={msg.tone} message={msg.text} /> : null, setMsg];
}

/** "2026-11-13" from an ISO string (Dhaka-agnostic display; the server keeps the instant). */
export function ymd(iso?: string | null): string {
  return iso ? bnNum(iso.slice(0, 10)) : "—";
}

/** `YYYY-MM-DD` typed → ISO at Dhaka noon, or null when empty / malformed. */
export function dateArg(s: string): string | null {
  const t = s.trim().replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T06:00:00.000Z` : null;
}

export function DiffView({ hunks }: { hunks: { words: { op: string; text: string }[] }[] }): React.ReactElement {
  const colors = useColors();
  return (
    <View>
      {hunks.map((h, i) => (
        <Text key={i} style={{ ...typeScale.body, color: colors.textPrimary, marginBottom: space(2) }}>
          {h.words.map((w, j) => (
            <Text
              key={j}
              style={
                w.op === "del"
                  ? { backgroundColor: "#FDE2E1", textDecorationLine: "line-through", color: "#8C1D18" }
                  : w.op === "ins"
                    ? { backgroundColor: "#DDF3E4", color: "#0B5C2E" }
                    : undefined
              }
            >
              {w.text}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  );
}
