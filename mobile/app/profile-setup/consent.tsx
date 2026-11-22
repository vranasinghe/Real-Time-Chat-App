import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { useOnboarding } from "@/lib/onboardingStore";

export default function ConsentScreen() {
  const { state, save } = useOnboarding();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!state) return;
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("consent", { accepted_policies: state.consent.current_versions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell
      step="consent"
      title="Before we start"
      subtitle="Dateza is for people aged 18 and over. Please read and accept our Terms of Service and Privacy Policy."
      onNext={submit}
      canNext={accepted}
      loading={loading}
      error={error}
    >
      <Pressable onPress={() => router.push("/profile/terms")} accessibilityRole="link" className="bg-bg-surface border border-white/5 rounded-2xl px-4 py-4 mb-3 active:bg-white/5">
        <Text className="text-white font-sans font-medium text-[16px]">Terms of Service</Text>
        <Text className="text-text-secondary font-sans text-[13px] mt-1">Draft, still being reviewed</Text>
      </Pressable>
      <Pressable onPress={() => router.push("/profile/privacy-policy")} accessibilityRole="link" className="bg-bg-surface border border-white/5 rounded-2xl px-4 py-4 mb-6 active:bg-white/5">
        <Text className="text-white font-sans font-medium text-[16px]">Privacy Policy</Text>
        <Text className="text-text-secondary font-sans text-[13px] mt-1">Draft, still being reviewed</Text>
      </Pressable>

      <Pressable
        onPress={() => setAccepted((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I am 18 or older and I accept the Terms of Service and the Privacy Policy"
        className="flex-row items-start"
      >
        <View className={`w-6 h-6 rounded-md border items-center justify-center mr-3 mt-0.5 ${accepted ? "bg-primary border-primary" : "border-text-secondary/40"}`}>
          {accepted ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
        </View>
        <Text className="flex-1 text-text-secondary font-sans text-[14px] leading-5">I am 18 or older and I accept the Terms of Service and the Privacy Policy.</Text>
      </Pressable>
    </OnboardingShell>
  );
}
