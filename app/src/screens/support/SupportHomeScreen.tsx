/**
 * শিক্ষার্থী সহায়তা — the entry (docs/prd-child-support-profile.md §9.5). Teachers: আমার রিপোর্ট.
 * Principal: the switch (ships OFF), the review queue, batches, safeguarding, profiles by class and name
 * (never ordered by concern). Each button checks its own action.
 */
import React from "react";
import { ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { SET_SUPPORT_SWITCH, SUPPORT_PROFILES, SUPPORT_SETTING } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportHome">;

export default function SupportHomeScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("support_profile:manage");
  const [setting, refetch] = useQuery<{ supportProfileSetting: { switchedOn: boolean; approvalLoadReviewDueKey: string | null } }>({ query: SUPPORT_SETTING, pause: !manage });
  const [profiles] = useQuery<{ supportProfilesPage: { rows: { id: string; studentId: string; studentName: string; status: string; published: boolean }[] } }>({
    query: SUPPORT_PROFILES,
    variables: { page: 1, pageSize: 50 },
    pause: !can("support_profile:view_all"),
  });
  const [, setSwitch] = useMutation(SET_SUPPORT_SWITCH);
  const on = setting.data?.supportProfileSetting.switchedOn;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {manage && setting.data ? (
          <Card>
            {!on ? <Notice message={STR.supHomeSwitchOff} tone="info" /> : null}
            <Button
              title={on ? STR.supSwitchOff : STR.supSwitchOn}
              variant={on ? "ghost" : "primary"}
              onPress={async () => {
                const r = await setSwitch({ on: !on });
                if (r.error) return toast.show(friendlyError(r.error), "danger");
                refetch({ requestPolicy: "network-only" });
              }}
            />
          </Card>
        ) : null}
        {can("support_profile:report") ? <Button title={STR.supMyReports} onPress={() => navigation.navigate("MySupportReports")} /> : null}
        {can("support_profile:approve") ? <Button title={STR.supQueueTitle} variant="secondary" onPress={() => navigation.navigate("SupportQueue")} /> : null}
        {can("support_profile:process") ? <Button title={STR.supBatchTitle} variant="secondary" onPress={() => navigation.navigate("SupportBatch")} /> : null}
        {can("safeguarding:receive") ? <Button title={STR.supRefTitle} variant="danger" onPress={() => navigation.navigate("SafeguardingReferrals")} /> : null}
        {profiles.data?.supportProfilesPage.rows.map((p) => (
          <Card key={p.id}>
            <Body>{p.studentName}</Body>
            <Muted>{`${p.status}${p.published ? "" : " · —"}`}</Muted>
            <Button title={STR.supFullProfile} variant="ghost" onPress={() => navigation.navigate("SupportCard", { studentId: p.studentId, via: "QUEUE", full: true })} />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
