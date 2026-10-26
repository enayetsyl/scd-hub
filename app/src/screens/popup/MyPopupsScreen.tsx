/**
 * আমার বার্তা (D-#855, PRD §8.3) — every pop-up the person received in the last 90 days,
 * newest first, so a parent who closed one too fast can read it again.
 *
 * Opening a row shows the notice with every lock off (they chose to read it). When the
 * sender allowed answer changes and the notice is still running, the answer buttons come
 * back and a new tap is recorded (D-#856). Staff and guardians share this screen; it is
 * registered in both Today stacks, never first.
 */
import React, { useState } from "react";
import { Platform, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { MY_POPUP_HISTORY_PAGE, RECORD_POPUP_EVENT, type PopupHistoryRowT } from "../../graphql/popupNotice";
import { Badge, Body, Card, EmptyState, ErrorBanner, Loader, Muted, Screen } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { PopupSheet } from "../../components/PopupSheet";
import { STR, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme";

const PAGE_SIZE = 20;

function stateBadge(r: PopupHistoryRowT): { text: string; tone: "ok" | "warn" | "muted" | "info" } {
  if (r.show.state === "ACTED") return { text: r.choiceLabel ? STR.ppAnswered.replace("{a}", r.choiceLabel) : STR.ppStateActed, tone: "ok" };
  if (r.show.state === "READ") return { text: STR.ppStateRead, tone: "ok" };
  if (r.show.state === "SEEN") return { text: STR.ppStateSeen, tone: "info" };
  return { text: STR.ppStateNotSeen, tone: "warn" };
}

export default function MyPopupsScreen(): React.ReactElement {
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: MY_POPUP_HISTORY_PAGE, variables: { page, pageSize: PAGE_SIZE }, requestPolicy: "cache-and-network" });
  const [, record] = useMutation(RECORD_POPUP_EVENT);
  const [open, setOpen] = useState<PopupHistoryRowT | null>(null);
  const en = getActiveLang() === "en";

  const data = q.data?.myPopupHistoryPage;
  if (q.fetching && !data) return <Loader label={STR.loading} />;

  return (
    <Screen scroll>
      <Muted style={{ marginBottom: space(3) }}>{STR.ppMineHint}</Muted>
      {q.error ? <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      {data && data.rows.length === 0 ? <EmptyState message={STR.ppMineEmpty} /> : null}
      {(data?.rows ?? []).map((r) => {
        const b = stateBadge(r);
        const title = en && r.show.titleEn ? r.show.titleEn : r.show.titleBn;
        return (
          <Card key={r.show.noticeId} onPress={() => setOpen(r)}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, fontWeight: "600" }}>{title}</Body>
              <Badge text={b.text} tone={b.tone} />
            </View>
            <Muted>
              {[r.show.fromLabel, r.publishedAt ? new Date(r.publishedAt).toLocaleDateString(en ? "en-GB" : "bn-BD") : ""].filter(Boolean).join(" · ")}
              {r.show.canChangeAnswer ? ` · ${STR.ppCanChange}` : ""}
            </Muted>
          </Card>
        );
      })}
      {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}

      {open ? (
        <PopupSheet
          key={open.show.noticeId}
          show={open.show}
          reread
          onClose={() => setOpen(null)}
          onAct={async (action, readMs) => {
            const res = await record({ input: { noticeId: open.show.noticeId, kind: "ACTED", choiceId: action.id, readMs, device: Platform.OS } });
            if (res.error) return friendlyError(res.error);
            setOpen(null);
            refetch({ requestPolicy: "network-only" });
            return null;
          }}
        />
      ) : null}
    </Screen>
  );
}
