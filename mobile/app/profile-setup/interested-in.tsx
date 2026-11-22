import React from "react";
import { ChoiceStep } from "@/components/onboarding/ChoiceStep";
import { useOnboarding } from "@/lib/onboardingStore";
import { INTERESTED_IN_LABELS } from "@/lib/onboardingApi";

export default function InterestedInScreen() {
  const state = useOnboarding((s) => s.state);
  const options = state?.options.interested_in ?? Object.keys(INTERESTED_IN_LABELS);
  return (
    <ChoiceStep
      step="interested_in"
      title="Who would you like to meet?"
      subtitle="We use this to show you people. You can change it any time."
      options={options.map((o) => ({ value: o, label: INTERESTED_IN_LABELS[o] ?? o }))}
      initial={state?.profile.looking_for}
      body={(value) => ({ looking_for: value })}
    />
  );
}
