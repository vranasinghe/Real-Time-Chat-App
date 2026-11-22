import React, { useEffect } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { Href } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { PrimaryButton, GhostButton } from "@/components/PrimaryButton";
import { useOnboarding } from "@/lib/onboardingStore";
import { routeFor } from "@/lib/onboardingApi";
import type { OnboardingState, StepId } from "@/lib/onboardingApi";
import { useAppStore } from "@/lib/store";

/** Opens the step the server says is next (or the review screen). */
export function goToNextStep(state: OnboardingState) {
  router.replace(routeFor(state.next_step) as Href);
}

interface ShellProps {
  /** Which step this screen is, for the progress bar. */
  step: StepId | "review";
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  nextLabel?: string;
  onNext: () => void | Promise<void>;
  loading?: boolean;
  error?: string;
  canNext?: boolean;
  /** Optional steps can be skipped: the answer is stored as "nothing" and the step counts as confirmed. */
  onSkip?: () => void | Promise<void>;
}

/** Common frame of every setup screen: progress, back, a message area, Continue and (optionally) Skip. */
export function OnboardingShell({ step, title, subtitle, children, nextLabel = "Continue", onNext, loading, error, canNext = true, onSkip }: ShellProps) {
  const { state, load, error: loadError } = useOnboarding();
  const signOut = useAppStore((s) => s.signOut);

  useEffect(() => {
    if (!state) void load(); // opened directly (deep link / page reload)
  }, [state, load]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile-setup" as Href);
  };

  if (!state) {
    return (
      <SafeAreaView className="flex-1 bg-bg-base items-center justify-center px-6">
        {loadError ? (
          <>
            <Text accessibilityRole="alert" className="text-like text-center font-sans text-[14px] mb-4">{loadError}</Text>
            <View className="w-full"><PrimaryButton label="Try again" onPress={() => void load()} /></View>
          </>
        ) : (
          <ActivityIndicator color="#7C5CFF" />
        )}
      </SafeAreaView>
    );
  }

  // Someone under 18 gets no further. The server enforces this too; this is the explanation.
  if (state.underage) {
    return (
      <SafeAreaView className="flex-1 bg-bg-base px-6 py-6 justify-between">
        <View className="mt-12">
          <Text className="text-white text-3xl font-bold font-display tracking-tight mb-3">You can{"'"}t use Dateza yet</Text>
          <Text className="text-text-secondary text-base font-sans leading-6">
            Dateza is for people aged 18 and over, and the date of birth you entered says you are younger. For safety it can{"'"}t be changed.
          </Text>
        </View>
        <View className="pb-4">
          <GhostButton label="Sign out" onPress={async () => { await signOut(); router.replace("/auth/sign-in" as Href); }} />
        </View>
      </SafeAreaView>
    );
  }

  const ids = state.steps.map((s) => s.id as string).concat("review");
  const index = Math.max(0, ids.indexOf(step));

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "space-between" }} className="px-6 py-6" showsVerticalScrollIndicator={false}>
          <View className="w-full">
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={`Step ${index + 1} of ${ids.length}`}
              accessibilityValue={{ min: 1, max: ids.length, now: index + 1 }}
              className="flex-row mb-5"
              style={{ gap: 4 }}
            >
              {ids.map((id, i) => (
                <View key={id} className={`flex-1 h-1.5 rounded-full ${i <= index ? "bg-primary" : "bg-bg-surface border border-white/5"}`} />
              ))}
            </View>

            <Pressable onPress={back} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} accessibilityRole="button" accessibilityLabel="Go back" className="self-start py-2 active:opacity-60">
              <ArrowLeft size={24} color="#FFFFFF" />
            </Pressable>

            <View className="mt-4 mb-8">
              <Text accessibilityRole="header" className="text-white text-3xl font-bold font-display tracking-tight mb-2">{title}</Text>
              {subtitle ? <Text className="text-text-secondary text-base font-sans leading-6">{subtitle}</Text> : null}
            </View>

            {error ? (
              <View accessibilityRole="alert" className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-5">
                <Text className="text-like font-sans text-[14px] font-medium text-center">{error}</Text>
              </View>
            ) : null}

            {children}
          </View>

          <View className="w-full pb-4 mt-8" style={{ gap: 12 }}>
            <PrimaryButton label={nextLabel} onPress={() => void onNext()} loading={loading} disabled={!canNext} />
            {onSkip ? <GhostButton label="Skip for now" onPress={() => void onSkip()} disabled={loading} /> : null}
          </View>
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
