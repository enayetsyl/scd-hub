/**
 * Root navigator — auth gate. While the token hydrates we show a loader; then
 * the Login screen (anon) or the role-based tabs (authed). The authed branch
 * also carries the root-level NotificationCenter modal (N-3) so one screen
 * serves every tab's 🔔, and the NotificationProvider that polls the unread
 * badge count for all of them.
 */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthContext";
import { NotificationProvider } from "../state/NotificationContext";
import { Loader } from "../components/ui";
import { STR } from "../lib/labels";
import { fonts, useColors } from "../theme";
import { AppTabs, LoginScreen } from "./AppTabs";
import NotificationCenterScreen from "../screens/notifications/NotificationCenterScreen";
import ReportProblemScreen from "../screens/common/ReportProblemScreen";

const RootStack = createNativeStackNavigator();

export function RootNavigator(): React.ReactElement {
  const { status } = useAuth();
  const colors = useColors();

  if (status === "loading") {
    return <Loader label={STR.loading} />;
  }

  return (
    <NotificationProvider>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {status === "authed" ? (
          <>
            <RootStack.Screen name="App" component={AppTabs} />
            <RootStack.Screen
              name="NotificationCenter"
              component={NotificationCenterScreen}
              options={{
                headerShown: true,
                presentation: "modal",
                title: STR.notifications,
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: colors.onPrimary,
                headerTitleStyle: { fontFamily: fonts.bold },
              }}
            />
            {/* MON-3: "Report a problem" — root modal reachable from every tab's header. */}
            <RootStack.Screen
              name="ReportProblem"
              component={ReportProblemScreen}
              options={{
                headerShown: true,
                presentation: "modal",
                title: STR.reportTitle,
                headerStyle: { backgroundColor: colors.primary },
                headerTintColor: colors.onPrimary,
                headerTitleStyle: { fontFamily: fonts.bold },
              }}
            />
          </>
        ) : (
          <RootStack.Screen name="Auth" component={LoginScreen} />
        )}
      </RootStack.Navigator>
    </NotificationProvider>
  );
}
