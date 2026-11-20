import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router, useRootNavigationState } from "expo-router";
import { useAppStore } from "@/lib/store";

/**
 * Demo entry point (also reachable as a deep link: /demo).
 * Starts a local-only session and drops the user straight into the app.
 */
export default function DemoScreen() {
  const enterDemoMode = useAppStore((state) => state.enterDemoMode);
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    let cancelled = false;
    enterDemoMode().then(() => {
      if (!cancelled) router.replace("/(tabs)");
    });
    return () => {
      cancelled = true;
    };
  }, [rootNavigationState?.key, enterDemoMode]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0E0720", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#7C5CFF" />
    </View>
  );
}
