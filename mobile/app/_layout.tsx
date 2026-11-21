import "../global.css";
import React, { useEffect } from "react";
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useAppStore } from "@/lib/store";
import { MEDIA_LIFETIME_MS } from "@/lib/media";
import { ResponsiveFrame } from "@/components/common/ResponsiveFrame";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_700Bold,
  SpaceGrotesk_600SemiBold,
} from "@expo-google-fonts/space-grotesk";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

SplashScreen.preventAutoHideAsync().catch(() => {});

const CustomPurpleTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#0E0720",
    card: "#1B1035",
    text: "#FFFFFF",
    border: "rgba(255, 255, 255, 0.05)",
    primary: "#7C5CFF",
  },
};

export default function RootLayout() {
  const initializeStore = useAppStore((state) => state.initializeStore);
  const resumeConnection = useAppStore((state) => state.resumeConnection);
  const session = useAppStore((state) => state.session);
  const isInitialized = useAppStore((state) => state.isInitialized);
  const segments = useSegments();
  const navState = useRootNavigationState();
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const state = useAppStore.getState();
      if (!state.isInitialized) return;
      const items = [...state.stories, ...state.messages.filter(message => message.kind === "image")];
      if (!items.length) return;
      const next = Math.min(...items.map(item => item.expires_at ? Date.parse(item.expires_at) : Date.parse(item.created_at) + MEDIA_LIFETIME_MS));
      if (!Number.isFinite(next) || next <= Date.now()) { state.expireMedia(); return; }
      timer = setTimeout(() => useAppStore.getState().expireMedia(), Math.min(next - Date.now() + 10, 2147483647));
    };
    const unsubscribe = useAppStore.subscribe(schedule);
    schedule();
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);

  const [fontsLoaded] = useFonts({
    SpaceGrotesk_700Bold,
    SpaceGrotesk_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  useEffect(() => {
    if (!fontsLoaded) return;
    // Hide native splash screen and initialize Zustand store
    const init = async () => {
      try {
        await initializeStore();
      } catch (e) {
        console.error("Store initialization failed", e);
      } finally {
        await SplashScreen.hideAsync().catch(() => {});
      }
    };
    init();
  }, [fontsLoaded]);

  // App returns to the foreground (or the browser tab becomes visible): reconnect + catch up
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void resumeConnection();
    });
    return () => sub.remove();
  }, [resumeConnection]);

  // Route protection on the client. (The backend independently rejects unauthenticated
  // API calls; this only keeps signed-out users off signed-in screens.)
  useEffect(() => {
    if (!navState?.key || !isInitialized || session) return;
    const first = String(segments[0] ?? "");
    const publicRoots = ["", "index", "onboarding", "auth", "live-demo", "demo", "auth-callback", "+not-found"];
    if (!publicRoots.includes(first)) router.replace("/");
  }, [navState?.key, isInitialized, session, segments, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={CustomPurpleTheme}>
          <StatusBar style="light" />
          <ResponsiveFrame>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#0E0720" },
              animation: "fade_from_bottom",
            }}
          />
          </ResponsiveFrame>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
