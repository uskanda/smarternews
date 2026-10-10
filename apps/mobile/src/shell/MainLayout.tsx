import { Drawer } from "expo-router/drawer";
import { useWindowDimensions } from "react-native";
import { SCRIM, useTheme } from "../theme/theme";
import { DrawerContent } from "./DrawerContent";

/** The reading screens, with the list of views in a drawer that comes out from the left. */
export function MainLayout() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent closeDrawer={() => props.navigation.closeDrawer()} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        // Wider than the strip at the screen's edge that Android keeps for its own back gesture.
        swipeEdgeWidth: 96,
        // No shadow anywhere: what is behind the drawer is dimmed instead.
        overlayColor: SCRIM,
        // Said by a screen reader for the dimmed area that closes the drawer.
        overlayAccessibilityLabel: "項目を閉じる",
        // Wide enough for two lines of a long category name at a large font size, with the list still visible beside it.
        drawerStyle: { width: Math.min(360, width - 56), backgroundColor: theme.colors.background, borderTopRightRadius: 0, borderBottomRightRadius: 0 },
        sceneStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Drawer.Screen name="list/[key]" />
    </Drawer>
  );
}
