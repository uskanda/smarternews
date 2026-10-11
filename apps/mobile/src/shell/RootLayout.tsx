import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProvider } from "../api/AppProvider";
import { ConnectionProvider, useConnection } from "../connection/ConnectionProvider";
import { NotificationsBridge } from "../notifications/NotificationsBridge";
import { ReaderSessionProvider } from "../reader/session";
import { loadThemeChoice, useThemeChoice } from "../theme/store";
import { useTheme } from "../theme/theme";
import { ToastProvider } from "../ui/toast";

function Screens() {
  const theme = useTheme();
  const { status } = useConnection();
  // Nothing is drawn until the stored connection has been read: neither screen may flash by.
  if (status === "loading") return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  const connected = status === "connected";
  const stack = (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
      <Stack.Protected guard={connected}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(main)" />
        <Stack.Screen name="article/[id]" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/reader-info" />
      </Stack.Protected>
      <Stack.Protected guard={!connected}>
        <Stack.Screen name="connect" />
      </Stack.Protected>
    </Stack>
  );
  return connected ? <NotificationsBridge>{stack}</NotificationsBridge> : stack;
}

export function RootLayout() {
  const theme = useTheme();
  const choice = useThemeChoice();
  useEffect(() => {
    void loadThemeChoice();
  }, []);
  // What the device draws itself follows the chosen scheme too: the bar at the bottom, and the keyboard.
  useEffect(() => {
    Appearance.setColorScheme(choice === "system" ? "unspecified" : theme.dark ? "dark" : "light");
  }, [choice, theme.dark]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <ConnectionProvider>
        <AppProvider>
          <ReaderSessionProvider>
            <ToastProvider>
              <Screens />
            </ToastProvider>
          </ReaderSessionProvider>
        </AppProvider>
      </ConnectionProvider>
    </GestureHandlerRootView>
  );
}
