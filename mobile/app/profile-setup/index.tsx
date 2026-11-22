import React, { useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { Href } from "expo-router";
import { PrimaryButton, GhostButton } from "@/components/PrimaryButton";
import { useOnboarding } from "@/lib/onboardingStore";
import { routeFor } from "@/lib/onboardingApi";
import { useAppStore } from "@/lib/store";

/**
 * Entry point of profile setup. Asks the SERVER where this member is (so setup resumes after an
 * interruption, on any device) and opens that step. Members who are already eligible go to the app.
 */
export default function ProfileSetupEntry() {
  const { state, error, load, reset } = useOnboarding();
  const signOut = useAppStore((s) => s.signOut);

  const start = React.useCallback(async () => {
    reset(); // never reuse another account's answers
    const next = await load();
    if (!next) return;
    if (next.eligibility.eligible) {
      await useAppStore.getState().refreshProfile();
      router.replace("/(tabs)");
      return;
    }
    router.replace(routeFor(next.next_step) as Href);
  }, [load, reset]);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <SafeAreaView className="flex-1 bg-bg-base items-center justify-center px-6">
      {error && !state ? (
        <View className="w-full" style={{ gap: 12 }}>
          <Text accessibilityRole="alert" className="text-like text-center font-sans text-[14px] mb-2">{error}</Text>
          <PrimaryButton label="Try again" onPress={() => void start()} />
          <GhostButton label="Sign out" onPress={async () => { await signOut(); router.replace("/auth/sign-in" as Href); }} />
        </View>
      ) : (
        <>
          <ActivityIndicator color="#7C5CFF" />
          <Text className="text-text-secondary font-sans text-[14px] mt-4">Loading your profile setup…</Text>
        </>
      )}
    </SafeAreaView>
  );
}
