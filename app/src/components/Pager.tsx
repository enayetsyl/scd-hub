/**
 * Pager — "‹ Previous · Page 2 / 7 · Next ›", the class-notes pager made reusable.
 * Renders nothing when everything fits on one page.
 */
import React from "react";
import { View } from "react-native";
import { Button, Muted } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { space } from "../theme/tokens";

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}): React.ReactElement | null {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pageCount <= 1) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(3), marginVertical: space(2) }}>
      <Button title={`‹ ${STR.cnPagePrev}`} variant="secondary" disabled={page <= 1} onPress={() => onPage(Math.max(1, page - 1))} />
      <Muted>
        {STR.cnPage} {bnNum(page)} / {bnNum(pageCount)}
      </Muted>
      <Button
        title={`${STR.cnPageNext} ›`}
        variant="secondary"
        disabled={page >= pageCount}
        onPress={() => onPage(Math.min(pageCount, page + 1))}
      />
    </View>
  );
}
