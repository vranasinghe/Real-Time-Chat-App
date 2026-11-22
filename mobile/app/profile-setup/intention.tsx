import React from "react";
import { ChoiceStep } from "@/components/onboarding/ChoiceStep";
import { useOnboarding } from "@/lib/onboardingStore";
import { INTENTION_LABELS } from "@/lib/onboardingApi";

export default function IntentionScreen() {
  const state = useOnboarding((s) => s.state);
  const options = state?.options.intentions ?? Object.keys(INTENTION_LABELS);
  return (
    <ChoiceStep
      step="intention"
      title="What are you looking for?"
      subtitle="Optional. It helps others understand what you are hoping for."
      options={options.map((o) => ({ value: o, label: INTENTION_LABELS[o] ?? o }))}
      initial={state?.profile.relationship_intention}
      body={(value) => ({ relationship_intention: value })}
      optional
    />
  );
}
