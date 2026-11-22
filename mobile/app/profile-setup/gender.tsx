import React from "react";
import { ChoiceStep } from "@/components/onboarding/ChoiceStep";
import { useOnboarding } from "@/lib/onboardingStore";
import { GENDER_LABELS } from "@/lib/onboardingApi";

export default function GenderScreen() {
  const state = useOnboarding((s) => s.state);
  const genders = state?.options.genders ?? Object.keys(GENDER_LABELS);
  return (
    <ChoiceStep
      step="gender"
      title="How do you identify?"
      subtitle="Choose the option that describes you. You can change this later in your profile."
      options={genders.map((g) => ({ value: g, label: GENDER_LABELS[g] ?? g }))}
      initial={state?.profile.gender}
      body={(value) => ({ gender: value })}
    />
  );
}
