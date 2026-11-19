/**
 * AuthImage — a picture served by the authenticated REST route (`/files/<id>`), shown at the
 * column's full width in its own shape. Web: the bytes are fetched with the bearer token and
 * shown from a blob URL (an <img> cannot send headers). Native: the Image sends the header
 * itself. A failed load shows nothing but the alt text, never an error.
 */
import React from "react";
import { Image, Platform, Text, View } from "react-native";
import { REST_BASE } from "../graphql/client";
import { getToken } from "../lib/tokenStore";
import { radius, space, useColors } from "../theme";

export default function AuthImage({ path, alt }: { path: string; alt?: string }): React.ReactElement | null {
  const colors = useColors();
  const [webUri, setWebUri] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [aspect, setAspect] = React.useState(4 / 3);
  const url = /^https?:\/\//i.test(path) ? path : `${REST_BASE}${path}`;
  const token = getToken();

  React.useEffect(() => {
    if (Platform.OS !== "web") return;
    let off = false;
    let made: string | null = null;
    setFailed(false);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (off) return;
        made = URL.createObjectURL(b);
        setWebUri(made);
      })
      .catch(() => {
        if (!off) setFailed(true);
      });
    return () => {
      off = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, token]);

  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const source = Platform.OS === "web" ? (webUri ? { uri: webUri } : null) : { uri: url, headers };
  if (failed) return alt ? <Text style={{ color: colors.textSecondary, marginBottom: space(2) }}>{alt}</Text> : null;
  return (
    <View
      style={{
        width: "100%",
        aspectRatio: aspect,
        maxHeight: 420,
        marginBottom: space(3),
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceAlt,
        overflow: "hidden",
      }}
    >
      {source ? (
        <Image
          source={source}
          accessibilityLabel={alt}
          resizeMode="contain"
          style={{ width: "100%", height: "100%" }}
          onLoad={(e) => {
            const s = (e.nativeEvent as { source?: { width?: number; height?: number } }).source;
            if (s?.width && s?.height) setAspect(s.width / s.height);
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}
