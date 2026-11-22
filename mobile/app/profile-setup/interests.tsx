import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { Chip } from "@/components/Chip";
import { TextField } from "@/components/TextField";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useOnboarding } from "@/lib/onboardingStore";

// Suggestions only. Nothing is selected for the member; they choose what applies to them.
const SUGGESTED = ["Music", "Travel", "Coffee", "Hiking", "Cooking", "Movies", "Gaming", "Fitness", "Art", "Reading", "Photography", "Dancing", "Pets", "Food"];

export default function InterestsScreen() {
  const { state, save } = useOnboarding();
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) setSelected(state.profile.interests);
  }, [state]);

  const toggle = (interest: string) =>
    setSelected((cur) => (cur.some((i) => i.toLowerCase() === interest.toLowerCase()) ? cur.filter((i) => i.toLowerCase() !== interest.toLowerCase()) : cur.length < 30 ? [...cur, interest] : cur));

  const addCustom = () => {
    const v = custom.trim();
    if (v && v.length <= 40) toggle(v);
    setCustom("");
  };

  const submit = async (list: string[]) => {
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("interests", { interests: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your interests.");
    } finally {
      setLoading(false);
    }
  };

  const options = [...SUGGESTED, ...selected.filter((s) => !SUGGESTED.some((x) => x.toLowerCase() === s.toLowerCase()))];

  return (
    <OnboardingShell step="interests" title="What are you into?" subtitle="Optional. Pick a few interests so people have something to talk about." onNext={() => submit(selected)} loading={loading} error={error} onSkip={() => submit([])}>
      <View className="flex-row flex-wrap">
        {options.map((o) => (
          <Chip key={o} label={o} active={selected.some((s) => s.toLowerCase() === o.toLowerCase())} onPress={() => toggle(o)} accessibilityRole="checkbox" />
        ))}
      </View>
      <View className="mt-4">
        <TextField label="Add your own" placeholder="Something else you love" value={custom} onChangeText={setCustom} maxLength={40} onSubmitEditing={addCustom} />
        <PrimaryButton label="Add" onPress={addCustom} disabled={!custom.trim()} />
      </View>
    </OnboardingShell>
  );
}
