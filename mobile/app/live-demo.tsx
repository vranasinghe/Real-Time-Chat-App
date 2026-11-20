import React, { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, Smartphone } from "lucide-react-native";
import { useAppStore, LiveDemoStatus } from "@/lib/store";

/**
 * Live Demo: pick one of two shared, pre-matched accounts. Open the app on a
 * second device and pick the other one to chat in real time, no sign-up.
 */
export default function LiveDemoScreen() {
  const insets = useSafeAreaInsets();
  const getLiveDemoStatus = useAppStore((s) => s.getLiveDemoStatus);
  const signInLiveDemo = useAppStore((s) => s.signInLiveDemo);

  const [status, setStatus] = useState<LiveDemoStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setStatus(null);
    try {
      setStatus(await getLiveDemoStatus());
    } catch {
      setLoadError("Can't reach the server. Check that the backend is running and this device can reach it.");
    }
  }, [getLiveDemoStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = async (key: string) => {
    setSignInError(null);
    setSigningIn(key);
    try {
      await signInLiveDemo(key);
      // Go straight into the chat with the other demo account
      const { matches, user } = useAppStore.getState();
      const demoChat = matches.find((m) => m.other_user?.id?.startsWith("demo-") && m.other_user.id !== user?.id);
      if (demoChat) {
        router.replace({ pathname: "/chat-thread", params: { matchId: demoChat.id } });
      } else {
        router.replace("/(tabs)/chat");
      }
    } catch (e: any) {
      setSignInError(e?.message || "Demo sign-in failed. Please try again.");
      setSigningIn(null);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn} accessibilityLabel="Go back">
        <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2.5} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Live Demo</Text>
        <Text style={styles.subtitle}>
          Chat in real time between two devices. No sign-up needed.
        </Text>

        <View style={styles.steps}>
          <Smartphone size={18} color="#7C5CFF" />
          <Text style={styles.stepsText}>
            Pick one person here, then open Dateza on your other device and pick the other one.
          </Text>
        </View>

        {!status && !loadError && <ActivityIndicator color="#7C5CFF" style={{ marginTop: 40 }} />}

        {loadError && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{loadError}</Text>
            <Pressable onPress={load} style={styles.retryBtn}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {status && !status.enabled && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Live demo is turned off on this server. Set DEMO_LOGIN_ENABLED=true on the backend to use it,
              or try the offline demo instead.
            </Text>
            <Pressable onPress={() => router.replace("/demo")} style={styles.retryBtn}>
              <Text style={styles.retryText}>Open offline demo</Text>
            </Pressable>
          </View>
        )}

        {status?.enabled &&
          status.personas.map((p) => {
            const busy = signingIn === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => pick(p.key)}
                disabled={!!signingIn}
                accessibilityRole="button"
                accessibilityLabel={`Continue as ${p.name}`}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                  !!signingIn && !busy && styles.cardDimmed,
                ]}
              >
                <Image source={{ uri: p.photo }} style={styles.avatar} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardName}>Continue as {p.name.replace(" (Demo)", "")}</Text>
                  <Text style={styles.cardBio} numberOfLines={2}>{p.bio}</Text>
                </View>
                {busy && <ActivityIndicator color="#FFFFFF" />}
              </Pressable>
            );
          })}

        {signInError && <Text style={styles.errorText}>{signInError}</Text>}

        {status?.enabled && (
          <Text style={styles.footnote}>
            These are shared demo accounts, so anyone using the demo sees the same chat. Messages are cleared after 24 hours.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0E0720" },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 48, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { color: "#FFFFFF", fontFamily: "SpaceGrotesk_700Bold", fontSize: 30, marginBottom: 8 },
  subtitle: { color: "#9A8FB8", fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22 },
  steps: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(124, 92, 255, 0.1)",
    borderColor: "rgba(124, 92, 255, 0.3)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 20,
    marginBottom: 24,
  },
  stepsText: { flex: 1, color: "#E4DEFF", fontFamily: "Inter_500Medium", fontSize: 14, lineHeight: 20 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#1B1035",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    marginBottom: 14,
  },
  cardPressed: { backgroundColor: "#24164A", borderColor: "#7C5CFF" },
  cardDimmed: { opacity: 0.5 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#2A1C52" },
  cardBody: { flex: 1 },
  cardName: { color: "#FFFFFF", fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 4 },
  cardBio: { color: "#9A8FB8", fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  notice: {
    backgroundColor: "#1B1035",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  noticeText: { color: "#E4DEFF", fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  retryBtn: { alignSelf: "flex-start", marginTop: 12, backgroundColor: "#7C5CFF", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  errorText: { color: "#FF8FB1", fontFamily: "Inter_500Medium", fontSize: 14, marginTop: 4 },
  footnote: { color: "#7D7399", fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 12 },
});
