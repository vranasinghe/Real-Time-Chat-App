import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { TextField } from "@/components/TextField";
import { useOnboarding } from "@/lib/onboardingStore";

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 250;

export default function AboutScreen() {
  const { state, save } = useOnboarding();
  const [bio, setBio] = useState("");
  const [height, setHeight] = useState<number | null>(null); // null = not shared
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) {
      setBio(state.profile.bio);
      setHeight(state.profile.height_cm);
    }
  }, [state]);

  const submit = async (values: { bio: string | null; height_cm: number | null }) => {
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("about", values));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this step.");
    } finally {
      setLoading(false);
    }
  };

  const step = (delta: number) => setHeight((h) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, (h ?? 170) + delta)));

  return (
    <OnboardingShell
      step="about"
      title="Tell people about you"
      subtitle="Optional. Write a short bio in your own words. Leave anything you prefer not to share empty."
      onNext={() => submit({ bio: bio.trim() || null, height_cm: height })}
      loading={loading}
      error={error}
      onSkip={() => submit({ bio: null, height_cm: null })}
    >
      <TextField label="Bio" placeholder="A few words about you" value={bio} onChangeText={setBio} multiline maxLength={1000} style={{ minHeight: 96, textAlignVertical: "top" }} />

      <Text className="text-text-secondary font-sans font-medium text-[14px] mt-2 mb-2">Height (optional)</Text>
      {height === null ? (
        <Pressable onPress={() => setHeight(170)} accessibilityRole="button" className="bg-bg-surface border border-white/5 rounded-2xl px-4 py-4 active:bg-white/5">
          <Text className="text-primary font-sans font-medium text-[15px]">Add my height</Text>
        </Pressable>
      ) : (
        <View className="flex-row items-center justify-between bg-bg-surface border border-white/5 rounded-2xl px-4 py-3">
          <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="Decrease height" className="w-11 h-11 rounded-xl border border-white/5 items-center justify-center active:bg-white/5"><Minus size={20} color="#FFFFFF" /></Pressable>
          <Text accessibilityLiveRegion="polite" className="text-white font-display text-2xl font-bold">{height} cm</Text>
          <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel="Increase height" className="w-11 h-11 rounded-xl border border-white/5 items-center justify-center active:bg-white/5"><Plus size={20} color="#FFFFFF" /></Pressable>
        </View>
      )}
      {height !== null ? (
        <Pressable onPress={() => setHeight(null)} accessibilityRole="button" className="py-3 self-start">
          <Text className="text-text-secondary font-sans text-[13px] underline">Don{"'"}t share my height</Text>
        </Pressable>
      ) : null}
    </OnboardingShell>
  );
}
