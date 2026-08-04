/**
 * BookPolicyScreen (SB-1, D-#403) — load the governance documents the validator runs
 * against.
 *
 * WHY THIS SCREEN HAD TO EXIST. The first real upload came back with all eight
 * documents listed under "Policy documents not found", and one of the REDs was
 * `letter inventory missing — a C1–C2 বাংলা book cannot merge unaudited`. That is not
 * a content error: the validator refuses because it cannot run the audit, and it
 * refuses rather than skipping so an unaudited primer never merges looking like it
 * passed. Until now the only way to load a document was a terminal mutation, which
 * makes the whole upload path unusable by the people it is for.
 *
 * POLICY IS DATA, NEVER REPO FILES (D-#403). Every generation and every merge stamps
 * the active set's hash, so a decision stays reproducible against the policy AS IT
 * STOOD. Activating a new version SUPERSEDES the previous one and never deletes it —
 * that is the whole mechanism, and it is why this screen has no delete.
 *
 * THE PER-BOOK / PROGRAMME-WIDE SPLIT IS LOAD-BEARING. `LETTER_INVENTORY` belongs to
 * ONE book; the other seven are programme-wide. Send a book id with a programme-wide
 * document and it becomes invisible to every other book; omit it on the inventory and
 * the audit never finds it. The screen sends the right one per key rather than asking
 * anyone to remember, and labels which is which.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useMutation } from "urql";
import { POLICY_DOC_KEYS, PER_BOOK_POLICY_DOC_KEYS } from "@scd/shared";
import {
  SUPPORT_BOOKS, SUPPORT_BOOK_POLICY_SET, ACTIVATE_SUPPORT_BOOK_POLICY,
  type SupportBookT, type SupportBookPolicySetT,
} from "../../graphql/supportBook";
import { Screen, Body, Muted, Card, Select, Badge, Button, EmptyState, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickTextFile, FileUploadError } from "../../lib/files";
import { space, useColors } from "../../theme";

const PER_BOOK = new Set<string>(PER_BOOK_POLICY_DOC_KEYS as readonly string[]);

function DocRow({
  docKey,
  version,
  bookId,
  onActivated,
}: {
  docKey: string;
  version: number | null;
  bookId: string;
  onActivated: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, activate] = useMutation(ACTIVATE_SUPPORT_BOOK_POLICY);

  const perBook = PER_BOOK.has(docKey);

  async function onPick(): Promise<void> {
    setNote(null);
    setBusy(true);
    try {
      const f = await pickTextFile();
      if (!f) return;
      if (!f.text.trim()) {
        setNote({ text: STR.sbPolicyEmptyFile, bad: true });
        return;
      }
      const r = await activate({
        docKey,
        body: f.text,
        // The split that decides whether this document is ever found again.
        bookId: perBook ? bookId : undefined,
      });
      if (r.error) {
        setNote({ text: friendlyError(r.error), bad: true });
        return;
      }
      setNote({ text: `${STR.sbPolicyActivated} — ${f.name}`, bad: false });
      onActivated();
    } catch (e) {
      setNote({ text: e instanceof FileUploadError ? e.message : String(e), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700" }}>{docKey}</Body>
        <View style={{ marginLeft: space(2) }}>
          <Badge
            text={version != null ? `${STR.sbPolicyVersion}${bnNum(version)}` : STR.sbMissing}
            tone={version != null ? "ok" : "warn"}
          />
        </View>
        <Muted style={{ marginLeft: space(2), fontSize: 12 }}>
          {perBook ? STR.sbPolicyPerBook : STR.sbPolicyProgramme}
        </Muted>
      </View>

      <Button
        title={STR.sbPolicyUpload}
        variant={version != null ? "ghost" : "secondary"}
        onPress={() => { void onPick(); }}
        loading={busy || res.fetching}
        disabled={busy || res.fetching}
        style={{ alignSelf: "flex-start", marginTop: 4 }}
      />

      {note ? (
        <Muted style={{ marginTop: 4, color: note.bad ? colors.error : colors.primary }}>{note.text}</Muted>
      ) : null}
    </View>
  );
}

export default function BookPolicyScreen(): React.ReactElement {
  const colors = useColors();
  const [booksQ, refetchBooks] = useQuery<{ supportBooks: SupportBookT[] }>({ query: SUPPORT_BOOKS });
  const books = booksQ.data?.supportBooks ?? [];
  const [pickedBook, setPickedBook] = useState<string | null>(null);
  const bookId = pickedBook ?? books[0]?.bookId ?? "";

  const [setQ, refetchSet] = useQuery<{ supportBookPolicySet: SupportBookPolicySetT }>({
    query: SUPPORT_BOOK_POLICY_SET,
    variables: { bookId },
    pause: !bookId,
  });
  const policySet = setQ.data?.supportBookPolicySet ?? null;

  const versionByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of policySet?.docs ?? []) m.set(d.docKey, d.version);
    return m;
  }, [policySet]);

  const missingCount = policySet?.missing.length ?? POLICY_DOC_KEYS.length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.sbPolicyTitle}</Body>
          <Muted>{STR.sbPolicySub}</Muted>
          <Select
            label={STR.sbBook}
            value={bookId || null}
            options={books.map((b) => ({ label: `${b.titleBn} (${b.bookId})`, value: b.bookId }))}
            onChange={(v) => setPickedBook(v)}
            placeholder={STR.sbBook}
          />
          {policySet ? (
            <>
              {/* The hash is what every patch and generation is stamped with — showing
                  it is what makes "validated against WHICH policy" answerable. */}
              <Muted style={{ marginTop: 4 }}>{`${STR.sbPolicyHash}: ${policySet.hash.slice(0, 16)}…`}</Muted>
              {missingCount === 0 ? (
                <Muted style={{ color: colors.primary }}>{STR.sbPolicyComplete}</Muted>
              ) : (
                <Muted style={{ color: colors.warning }}>
                  {`${STR.sbPolicyMissingList}: ${bnNum(missingCount)} / ${bnNum(POLICY_DOC_KEYS.length)}`}
                </Muted>
              )}
            </>
          ) : null}
        </Card>

        <View style={{ height: space(3) }} />

        <QueryGate
          results={[booksQ, setQ]}
          onRetry={() => {
            refetchBooks({ requestPolicy: "network-only" });
            refetchSet({ requestPolicy: "network-only" });
          }}
          loaderLabel={STR.loading}
        >
          {!bookId ? (
            <EmptyState message={STR.sbPolicyNeedBook} />
          ) : (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.sbPolicyActive}</Body>
              <Divider />
              {POLICY_DOC_KEYS.map((k) => (
                <DocRow
                  key={k}
                  docKey={k}
                  version={versionByKey.get(k) ?? null}
                  bookId={bookId}
                  onActivated={() => refetchSet({ requestPolicy: "network-only" })}
                />
              ))}
            </Card>
          )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
