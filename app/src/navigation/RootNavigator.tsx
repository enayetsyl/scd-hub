/**
 * Root navigator — auth gate. While the token hydrates we show a loader; then
 * the Login screen (anon) or the role-based tabs (authed).
 */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthContext";
import { Loader } from "../components/ui";
import { STR } from "../lib/labels";
import { AppTabs, LoginScreen } from "./AppTabs";

const RootStack = createNativeStackNavigator();

export function RootNavigator(): React.ReactElement {
  const { status } = useAuth();

  if (status === "loading") {
    return <Loader label={STR.loading} />;
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {status === "authed" ? (
        <RootStack.Screen name="App" component={AppTabs} />
      ) : (
        <RootStack.Screen name="Auth" component={LoginScreen} />
      )}
    </RootStack.Navigator>
  );
}
