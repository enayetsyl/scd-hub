/**
 * HelpShot (prd-help-centre §2.3, D-#968) — one guide screenshot with its numbered red
 * boxes drawn on top. The picture itself is clean; each step's `box` ([x, y, w, h]
 * fractions) becomes a box here, so the numbers stay sharp at any width and the step the
 * person tapped can light up its own box while the others fade.
 *
 * The picture needs the login header (GET /files/help/…). Web fetches it into a blob
 * URL; native passes the header on the Image source.
 */
import React, { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import { REST_BASE } from "../graphql/client";
import type { HelpRowT } from "../graphql/help";
import { bnDigits } from "../lib/helpGuides";
import { STR } from "../lib/labels";
import { getToken } from "../lib/tokenStore";
import { fonts, radius, space, useColors } from "../theme";
import { Muted } from "./ui";

/** A phone screenshot wider than this reads worse, not better, on a laptop. */
const MAX_SHOT_WIDTH = 340;

function useShotSource(path: string): { uri: string; headers?: Record<string, string> } | null | "error" {
  const [webUri, setWebUri] = useState<string | null | "error">(null);
  const token = getToken();
  const url = `${REST_BASE}${path}`;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let revoked = false;
    let made: string | null = null;
    setWebUri(null);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        made = URL.createObjectURL(await res.blob());
        if (!revoked) setWebUri(made);
      })
      .catch(() => !revoked && setWebUri("error"));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, token]);
  if (Platform.OS === "web") return webUri === null || webUri === "error" ? webUri : { uri: webUri };
  return { uri: url, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

export function HelpShot({
  row,
  firstStepNo,
  active,
  onPressStep,
}: {
  row: HelpRowT;
  /** Number of this row's first step within the whole guide (numbers run on across rows). */
  firstStepNo: number;
  /** Index (within this row) of the step the person tapped, or null for "show all". */
  active: number | null;
  onPressStep: (index: number) => void;
}): React.ReactElement {
  const colors = useColors();
  const [boxWidth, setBoxWidth] = useState(0);
  const source = useShotSource(row.shotUrl);
  const width = Math.min(boxWidth, MAX_SHOT_WIDTH);
  const height = row.width > 0 ? (width * row.height) / row.width : 0;

  return (
    <View onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)} style={{ width: "100%", alignItems: "center" }}>
      {width > 0 ? (
        <View
          style={{
            width,
            height,
            borderRadius: radius.md,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceAlt,
          }}
        >
          {source && source !== "error" ? (
            <Image source={source} style={{ width, height }} resizeMode="stretch" accessibilityIgnoresInvertColors />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space(4) }}>
              <Muted>{source === "error" ? STR.hcShotFailed : STR.loading}</Muted>
            </View>
          )}
          {row.steps.map((s, i) => {
            const [x, y, w, h] = s.box;
            const on = active === null || active === i;
            const tone = on ? colors.error : colors.textDisabled;
            return (
              <Pressable
                key={i}
                onPress={() => onPressStep(i)}
                accessibilityLabel={`${STR.hcStep} ${bnDigits(firstStepNo + i)}`}
                style={{
                  position: "absolute",
                  left: x * width - 3,
                  top: y * height - 3,
                  width: w * width + 6,
                  height: h * height + 6,
                  borderWidth: active === i ? 3 : 2,
                  borderColor: tone,
                  borderRadius: 6,
                }}
              >
                <View
                  style={{
                    position: "absolute",
                    top: -11,
                    right: -11,
                    minWidth: 22,
                    height: 22,
                    borderRadius: 11,
                    paddingHorizontal: 4,
                    backgroundColor: tone,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 }}>
                    {bnDigits(firstStepNo + i)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
