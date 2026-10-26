/**
 * StaffListScreen — the HR staff directory (Principal/Office, staff_records:view).
 *
 * Owner ask 2026-10-26: a TABLE like the old school system's teacher list (SL, ID, name,
 * designation, status, joining date, years in the institution, phone, actions) in the app's colours, and
 * people who have LEFT (resigned / terminated / retired / contract ended) hidden until the
 * reader asks for everyone. The row stays a doorway (SH-6): the name opens the staff hub,
 * Edit opens the form. Search, the category chips and the show-all switch run on the client
 * — the staff list is a few dozen rows.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { AdminStackParamList } from "../../navigation/types";
import { HR_CATEGORIES } from "@scd/shared";
import { STAFF_QUERY, type StaffT } from "../../graphql/operations";
import { useAuth } from "../../auth/AuthContext";
import { Screen, H2, Body, Muted, Card, Button, Field, Loader, EmptyState, ErrorBanner } from "../../components/ui";
import { STR, bnNum, hrCategoryLabel, employmentStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { personName, personNameAlt } from "../../lib/personName";
import { space } from "../../theme/tokens";
import { useTablePaper } from "../../theme/tablePaper";

/** Statuses of someone who has left — the same set StaffLetterService calls HAS_LEFT. */
const HAS_LEFT: ReadonlySet<string> = new Set(["resigned", "terminated", "retired", "contract_ended"]);

/** Widths are the columns' minimums AND their share of spare width (RosterScreen's rule):
 *  the table fills a desktop frame and scrolls sideways on a phone. */
const COLUMNS = [
  { key: "sl", labelKey: "rosterColSl", width: 64 },
  { key: "id", labelKey: "staffId", width: 76 },
  { key: "name", labelKey: "rosterColName", width: 170 },
  { key: "designation", labelKey: "designation", width: 140 },
  { key: "status", labelKey: "employmentStatus", width: 120 },
  { key: "joined", labelKey: "joiningDate", width: 140 },
  { key: "years", labelKey: "staffColYears", width: 120 },
  { key: "phone", labelKey: "phone", width: 150 },
  { key: "actions", labelKey: "staffColActions", width: 96 },
] as const;
const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);

/** ISO timestamp → DD/MM/YYYY in Bangla numerals. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return bnNum(`${d}/${m}/${y}`);
}

/** Years since joining, one decimal (the old system's "Years in Institution"). */
function yearsSince(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > now) return "—";
  return bnNum(((now - t) / (365.25 * 24 * 3600 * 1000)).toFixed(1));
}

/** Numeric ID order (the old list's order), names breaking ties and ordering ID-less rows. */
function byId(a: StaffT, b: StaffT): number {
  const na = Number(a.schoolId);
  const nb = Number(b.schoolId);
  const ha = a.schoolId && !Number.isNaN(na);
  const hb = b.schoolId && !Number.isNaN(nb);
  if (ha && hb && na !== nb) return na - nb;
  if (ha !== hb) return ha ? -1 : 1;
  return personName(a).localeCompare(personName(b));
}

function Cell({ width, children }: { width: number; children: React.ReactNode }): React.ReactElement {
  return <View style={{ flexGrow: width, flexBasis: width, padding: space(2), justifyContent: "center" }}>{children}</View>;
}

export default function StaffListScreen(): React.ReactElement {
  const nav = useNavigation<NavigationProp<AdminStackParamList>>();
  const paper = useTablePaper();
  // PM: the list is staff_records:view; adding and editing are their own actions.
  const { can } = useAuth();
  const canCreate = can("staff_records:create");
  const canEdit = can("staff_records:edit");
  const [category, setCategory] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);

  // Refetch on focus: returning from the form must show the record just saved, not the
  // list as it was before it existed.
  React.useEffect(
    () => nav.addListener("focus", () => refetch({ requestPolicy: "network-only" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nav],
  );

  const [{ data, fetching, error }, refetch] = useQuery({
    query: STAFF_QUERY,
    variables: { category },
  });

  const staff = data?.staff ?? [];
  const current = staff.filter((s) => !HAS_LEFT.has(s.employmentStatus ?? ""));
  const formerCount = staff.length - current.length;
  const pool = showAll ? staff : current;
  const q = search.trim().toLowerCase();
  const shown = (
    q
      ? pool.filter((s) => {
          const categoryLabel = hrCategoryLabel(s.category).toLowerCase();
          return (
            (s.nameBn ?? "").toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            (s.schoolId ?? "").toLowerCase().includes(q) ||
            (s.phone ?? "").toLowerCase().includes(q) ||
            (s.designation ?? "").toLowerCase().includes(q) ||
            categoryLabel.includes(q)
          );
        })
      : pool
  )
    .slice()
    .sort(byId);
  const now = Date.now();

  return (
    <Screen scroll wide>
      <View style={{ gap: space(3) }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
          <View>
            <H2>{STR.staff}</H2>
            {data ? (
              <Muted>
                {`${bnNum(pool.length)} ${STR.staffCount}`}
                {!showAll && formerCount > 0 ? ` · ${STR.staffFormerHidden.replace("{n}", bnNum(formerCount))}` : ""}
              </Muted>
            ) : null}
          </View>
          {/* SH-6: joining walks the 4-step wizard; the flat form stays for EDITS only. */}
          {canCreate ? <Button title={`+ ${STR.staffNew}`} onPress={() => nav.navigate("StaffJoin")} /> : null}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3), alignItems: "center" }}>
          <View style={{ flexGrow: 2, flexBasis: 260 }}>
            <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.searchStaff} />
          </View>
          <Button
            title={showAll ? STR.staffShowCurrent : STR.staffShowAll}
            variant={showAll ? "primary" : "secondary"}
            onPress={() => setShowAll((v) => !v)}
          />
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          <Button
            title={STR.allCategories}
            variant={category === null ? "primary" : "secondary"}
            onPress={() => setCategory(null)}
          />
          {HR_CATEGORIES.map((c) => (
            <Button
              key={c}
              title={hrCategoryLabel(c)}
              variant={category === c ? "primary" : "secondary"}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>

        {error ? (
          <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : fetching && staff.length === 0 ? (
          <Loader label={STR.loading} />
        ) : pool.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : shown.length === 0 ? (
          <EmptyState message={STR.noMatches} />
        ) : (
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
              <View style={{ minWidth: TABLE_WIDTH, flexGrow: 1 }}>
                <View style={{ flexDirection: "row", backgroundColor: paper.headerBg }}>
                  {COLUMNS.map((col) => (
                    <View
                      key={col.key}
                      style={{
                        flexGrow: col.width,
                        flexBasis: col.width,
                        paddingVertical: space(2),
                        paddingHorizontal: space(2),
                        justifyContent: "center",
                        borderRightWidth: 1,
                        borderRightColor: paper.headerDivider,
                      }}
                    >
                      <Text style={{ color: paper.headerText, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {STR[col.labelKey]}
                      </Text>
                    </View>
                  ))}
                </View>

                {shown.map((s, i) => {
                  const left = HAS_LEFT.has(s.employmentStatus ?? "");
                  return (
                    <View
                      key={s.id}
                      style={{
                        flexDirection: "row",
                        backgroundColor: i % 2 === 0 ? paper.rowEven : paper.rowOdd,
                        borderBottomWidth: 1,
                        borderBottomColor: paper.rowBorder,
                        opacity: left ? 0.75 : 1,
                      }}
                    >
                      <Cell width={COLUMNS[0].width}>
                        <Body style={{ color: paper.text }}>{bnNum(i + 1)}</Body>
                      </Cell>
                      <Cell width={COLUMNS[1].width}>
                        <Body style={{ color: paper.text }}>{s.schoolId ?? "—"}</Body>
                      </Cell>
                      <Cell width={COLUMNS[2].width}>
                        <Pressable accessibilityRole="link" onPress={() => nav.navigate("StaffHub", { staff: s })}>
                          <Body style={{ color: paper.link, fontWeight: "600" }}>{personName(s)}</Body>
                        </Pressable>
                        {personNameAlt(s) ? <Muted style={{ color: paper.textMuted }}>{personNameAlt(s)}</Muted> : null}
                      </Cell>
                      <Cell width={COLUMNS[3].width}>
                        <Body style={{ color: paper.text }}>{s.designation || hrCategoryLabel(s.category)}</Body>
                        {s.designation ? <Muted style={{ color: paper.textMuted }}>{hrCategoryLabel(s.category)}</Muted> : null}
                      </Cell>
                      <Cell width={COLUMNS[4].width}>
                        <Body style={{ color: left ? paper.toneDanger : paper.text, fontWeight: left ? "700" : "400" }}>
                          {employmentStatusLabel(s.employmentStatus)}
                        </Body>
                      </Cell>
                      <Cell width={COLUMNS[5].width}>
                        <Body style={{ color: paper.text }} numberOfLines={1}>{formatDate(s.joiningDate)}</Body>
                      </Cell>
                      <Cell width={COLUMNS[6].width}>
                        <Body style={{ color: paper.text }}>{yearsSince(s.joiningDate, now)}</Body>
                      </Cell>
                      <Cell width={COLUMNS[7].width}>
                        <Body style={{ color: paper.text }} numberOfLines={1}>{s.phone ?? "—"}</Body>
                      </Cell>
                      <Cell width={COLUMNS[8].width}>
                        {canEdit ? (
                          <Pressable accessibilityRole="button" onPress={() => nav.navigate("StaffForm", { staff: s })}>
                            <Body style={{ color: paper.link, fontWeight: "600" }} numberOfLines={1}>{STR.staffEditAction}</Body>
                          </Pressable>
                        ) : (
                          <Muted style={{ color: paper.textMuted }}>—</Muted>
                        )}
                      </Cell>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </Card>
        )}
      </View>
    </Screen>
  );
}
