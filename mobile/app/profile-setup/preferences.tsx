import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { useOnboarding } from "@/lib/onboardingStore";

const MIN = 18;
const MAX = 99;

function Stepper({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <View className="flex-row items-center justify-between bg-bg-surface border border-white/5 rounded-2xl px-4 py-3 mb-3">
      <Text className="text-text-secondary font-sans text-[15px]">{label}</Text>
      <View className="flex-row items-center" style={{ gap: 14 }}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} className="w-11 h-11 rounded-xl border border-white/5 items-center justify-center active:bg-white/5"><Minus size={18} color="#FFFFFF" /></Pressable>
        <Text accessibilityLiveRegion="polite" className="text-white font-display text-xl font-bold w-10 text-center">{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} accessibilityRole="button" accessibilityLabel={`Increase ${label}`} className="w-11 h-11 rounded-xl border border-white/5 items-center justify-center active:bg-white/5"><Plus size={18} color="#FFFFFF" /></Pressable>
      </View>
    </View>
  );
}

export default function PreferencesScreen() {
  const { state, save } = useOnboarding();
  const [range, setRange] = useState<{ min: number; max: number } | null>(null); // null = no preference
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state && state.profile.min_age !== null && state.profile.max_age !== null) {
      setRange({ min: state.profile.min_age, max: state.profile.max_age });
    }
  }, [state]);

  const submit = async (value: { min_age: number | null; max_age: number | null }) => {
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("preferences", value));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your preferences.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell
      step="preferences"
      title="Who do you want to see?"
      subtitle="Optional. Choose an age range, or leave it open to see everyone."
      onNext={() => submit(range ? { min_age: range.min, max_age: range.max } : { min_age: null, max_age: null })}
      loading={loading}
      error={error}
      onSkip={() => submit({ min_age: null, max_age: null })}
    >
      {range ? (
        <>
          <Stepper label="Youngest" value={range.min} min={MIN} max={range.max} onChange={(n) => setRange({ ...range, min: n })} />
          <Stepper label="Oldest" value={range.max} min={range.min} max={MAX} onChange={(n) => setRange({ ...range, max: n })} />
          <Pressable onPress={() => setRange(null)} accessibilityRole="button" className="py-3 self-start"><Text className="text-text-secondary font-sans text-[13px] underline">No age preference</Text></Pressable>
        </>
      ) : (
        <Pressable onPress={() => setRange({ min: 25, max: 40 })} accessibilityRole="button" className="bg-bg-surface border border-white/5 rounded-2xl px-4 py-4 active:bg-white/5">
          <Text className="text-primary font-sans font-medium text-[15px]">Choose an age range</Text>
          <Text className="text-text-secondary font-sans text-[13px] mt-1">Currently: everyone aged 18 and over</Text>
        </Pressable>
      )}
    </OnboardingShell>
  );
}
