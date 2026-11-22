import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { Calendar } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { TextField } from "@/components/TextField";
import { useOnboarding } from "@/lib/onboardingStore";
import { validateBirthdate } from "@/lib/age";

export default function BirthdaySetupScreen() {
  const { state, save } = useOnboarding();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Show what was saved before (resume), but never a value the app guessed: the server hides those.
  useEffect(() => {
    const saved = state?.profile.birthdate;
    if (saved) {
      const [y, m, d] = saved.slice(0, 10).split("-");
      setYear(y);
      setMonth(m);
      setDay(d);
    }
  }, [state?.profile.birthdate]);

  const submit = async () => {
    // Quick feedback here; the server checks the date again and has the final say.
    const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const check = validateBirthdate(iso);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("birthday", { birthdate: iso }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your date of birth.");
    } finally {
      setLoading(false);
    }
  };

  const locked = state?.birthdate_locked && !state?.underage;

  return (
    <OnboardingShell
      step="birthday"
      title="When's your birthday?"
      subtitle="Your age will be visible to others, but not your actual birth date."
      onNext={submit}
      loading={loading}
      error={error}
      canNext={!locked && day.length > 0 && month.length > 0 && year.length === 4}
    >
      <View className="flex-row" style={{ gap: 14 }}>
        <View className="flex-1"><TextField label="Day" placeholder="DD" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} editable={!locked} /></View>
        <View className="flex-1"><TextField label="Month" placeholder="MM" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} editable={!locked} /></View>
        <View className="flex-1"><TextField label="Year" placeholder="YYYY" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} editable={!locked} /></View>
      </View>
      <View className="flex-row items-center bg-bg-surface border border-white/5 p-4 rounded-2xl mt-2" style={{ gap: 8 }}>
        <Calendar size={20} color="#9A8FB8" />
        <Text className="flex-1 text-text-secondary font-sans text-[13px] leading-5">
          {locked ? "Your date of birth can't be changed after setup. Contact support if it is wrong." : "You must be at least 18 years old to join Dateza."}
        </Text>
      </View>
    </OnboardingShell>
  );
}
