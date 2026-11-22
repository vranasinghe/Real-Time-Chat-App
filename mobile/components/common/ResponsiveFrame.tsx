import React from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "@/lib/store";
import { MAX_APP_WIDTH } from "@/lib/layout";

// Shows while a signed-in user's live connection is down (offline, server waking up,
// app just resumed). Chat keeps working from saved data and catches up on reconnect.
// Members who are still setting up their profile have no live connection by design, so no banner.
function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const show = useAppStore((s) => s.isInitialized && s.session && !s.isDemo && s.profileSetupComplete && !s.socketConnected);
  if (!show) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        paddingTop: insets.top + 4,
        paddingBottom: 6,
        backgroundColor: "rgba(124,92,255,0.92)",
        alignItems: "center",
      }}
      pointerEvents="none"
    >
      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Reconnecting…</Text>
    </View>
  );
}

/** Centres the whole app in a phone-width column on wide screens; passes through on phones. */
export function ResponsiveFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width > MAX_APP_WIDTH;

  return (
    <View style={{ flex: 1, backgroundColor: wide ? "#07030F" : "#0E0720", alignItems: "center" }}>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: MAX_APP_WIDTH,
          overflow: "hidden",
          ...(wide ? { borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.06)" } : null),
        }}
      >
        {children}
        <ConnectionBanner />
      </View>
    </View>
  );
}
