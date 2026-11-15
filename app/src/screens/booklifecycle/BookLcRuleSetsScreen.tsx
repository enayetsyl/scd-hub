/**
 * S13 নিয়ম-সংকলন — locked cross-book rule sets (docs/prd-book-lifecycle.md §5.9): list, versions,
 * upload a new version (manage), which books. A new version supersedes the old; old ones stay readable.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { BL_RULESETS, BL_UPLOAD_RULESET } from "../../graphql/bookLifecycle";
import { Badge, Body, Button, Card, EmptyState, Field, Muted, Screen } from "../../components/ui";
import Markdown from "../../components/Markdown";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { bnNum } from "../../lib/labels";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { useMsg, ymd } from "./blCommon";

export default function BookLcRuleSetsScreen(): React.ReactElement {
  const { can } = useAuth();
  const manage = can("book_lifecycle:manage");
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: BL_RULESETS, variables: { page, pageSize: 30 }, requestPolicy: "cache-and-network" });
  const [{ fetching }, upload] = useMutation(BL_UPLOAD_RULESET);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useMsg();
  const [form, setForm] = useState({ key: "", titleBn: "", bodyMarkdown: "", bookCodes: "" });
  return (
    <Screen scroll>
      {manage ? (
        <Card style={{ marginBottom: space(3) }}>
          <Field label={BL.rsKey} value={form.key} onChangeText={(t) => setForm({ ...form, key: t })} />
          <Field label={BL.rsTitle} value={form.titleBn} onChangeText={(t) => setForm({ ...form, titleBn: t })} autoCapitalize="sentences" />
          <Field label={BL.rsBody} value={form.bodyMarkdown} onChangeText={(t) => setForm({ ...form, bodyMarkdown: t })} multiline autoCapitalize="sentences" />
          <Field label={BL.rsBooks} value={form.bookCodes} onChangeText={(t) => setForm({ ...form, bookCodes: t })} autoCapitalize="characters" />
          <Button
            title={BL.rsUpload}
            loading={fetching}
            onPress={() =>
              void upload({ key: form.key.trim(), titleBn: form.titleBn, bodyMarkdown: form.bodyMarkdown, bookCodes: form.bookCodes.split(/[,\s]+/).filter(Boolean) }).then((res) => {
                if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
                setForm({ key: "", titleBn: "", bodyMarkdown: "", bookCodes: "" });
                setMsg({ tone: "ok", text: BL.done });
                refetch({ requestPolicy: "network-only" });
              })
            }
          />
          {msg}
        </Card>
      ) : null}
      <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} isEmpty={!q.data?.bookLcRuleSetsPage.rows.length} empty={<EmptyState message={BL.noRuleSets} />}>
        {q.data?.bookLcRuleSetsPage.rows.map((r) => (
          <Card key={r.id} onPress={() => setOpen(open === r.id ? null : r.id)} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ fontWeight: "700" }}>
                {r.titleBn} · {r.key} v{bnNum(r.version)}
              </Body>
              <Badge text={r.status === "active" ? BL.rsActive : BL.rsSuperseded} tone={r.status === "active" ? "ok" : "muted"} />
            </View>
            <Muted>
              {r.bookCodes.length ? r.bookCodes.join(", ") : BL.all} · {ymd(r.createdAt)}
            </Muted>
            {open === r.id ? <Markdown source={r.bodyMarkdown} /> : null}
          </Card>
        ))}
        {q.data ? <Pager {...q.data.bookLcRuleSetsPage} onPage={setPage} /> : null}
      </QueryGate>
    </Screen>
  );
}
