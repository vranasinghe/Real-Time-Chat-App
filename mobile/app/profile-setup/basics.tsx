import React, { useEffect, useState } from "react";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { TextField } from "@/components/TextField";
import { useOnboarding } from "@/lib/onboardingStore";

export default function BasicsScreen() {
  const { state, save } = useOnboarding();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) setName(state.profile.name);
  }, [state]);

  const submit = async () => {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save("basics", { name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your name.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell step="basics" title="What should we call you?" subtitle="This is the name other members will see." onNext={submit} loading={loading} error={error} canNext={name.trim().length > 0}>
      <TextField label="Name" placeholder="Your first name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={100} />
    </OnboardingShell>
  );
}
