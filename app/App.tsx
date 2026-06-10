import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { Provider as UrqlProvider } from "urql";

import { urqlClient } from "./src/graphql/client";
import { AuthProvider } from "./src/auth/AuthContext";
import { BasketProvider } from "./src/state/BasketContext";
import { SectionProvider } from "./src/state/SectionContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <UrqlProvider value={urqlClient}>
        <AuthProvider>
          <BasketProvider>
            <SectionProvider>
              <NavigationContainer>
                <RootNavigator />
              </NavigationContainer>
              <StatusBar style="light" />
            </SectionProvider>
          </BasketProvider>
        </AuthProvider>
      </UrqlProvider>
    </SafeAreaProvider>
  );
}
