import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { Provider as UrqlProvider } from "urql";

import { urqlClient } from "./src/graphql/client";
import { AuthProvider } from "./src/auth/AuthContext";
import { BasketProvider } from "./src/state/BasketContext";
import { SectionProvider } from "./src/state/SectionContext";
import { LanguageProvider, useLanguage } from "./src/state/LanguageContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

/**
 * Keying RootNavigator by the active language remounts the navigation subtree on a
 * language switch, so every screen re-reads the new language. The providers above
 * (auth, basket, section) sit outside the key and keep their state.
 */
function LanguageScopedNavigator(): React.ReactElement {
  const { lang } = useLanguage();
  return <RootNavigator key={lang} />;
}

export default function App(): React.ReactElement {
  return (
    <SafeAreaProvider>
      <UrqlProvider value={urqlClient}>
        <LanguageProvider>
          <AuthProvider>
            <BasketProvider>
              <SectionProvider>
                <NavigationContainer>
                  <LanguageScopedNavigator />
                  <StatusBar style="light" />
                </NavigationContainer>
              </SectionProvider>
            </BasketProvider>
          </AuthProvider>
        </LanguageProvider>
      </UrqlProvider>
    </SafeAreaProvider>
  );
}
