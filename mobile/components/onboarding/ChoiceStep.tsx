import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Check } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "./OnboardingShell";
import { useOnboarding } from "@/lib/onboardingStore";
import type { StepId } from "@/lib/onboardingApi";

interface Option {
  value: string;
  label: string;
}

interface Props {
  step: StepId;
  title: string;
  subtitle?: string;
  options: Option[];
  /** The member's confirmed answer, if any. Nothing is pre-selected otherwise. */
  initial: string | null | undefined;
  /** Request body for the chosen value. */
  body: (value: string | null) => Record<string, unknown>;
  /** Optional steps offer "Skip": the answer is stored as nothing. */
  optional?: boolean;
}

/** One question, one choice, saved to the server. Nothing is selected until the member selects it. */
export function ChoiceStep({ step, title, subtitle, options, initial, body, optional }: Props) {
  const save = useOnboarding((s) => s.save);
  const [value, setValue] = useState<string | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(initial ?? null);
  }, [initial]);

  const submit = async (chosen: string | null) => {
    setLoading(true);
    setError("");
    try {
      goToNextStep(await save(step, body(chosen)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this answer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell
      step={step}
      title={title}
      subtitle={subtitle}
      onNext={() => submit(value)}
      canNext={value !== null}
      loading={loading}
      error={error}
      onSkip={optional ? () => submit(null) : undefined}
    >
      <View accessibilityRole="radiogroup">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => setValue(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={o.label}
              className={`flex-row justify-between items-center bg-bg-surface px-4 py-4 rounded-2xl mb-3.5 border ${active ? "border-primary" : "border-white/5"} active:bg-white/5`}
            >
              <Text className={`font-sans text-[16px] ${active ? "text-white font-bold" : "text-text-secondary"}`}>{o.label}</Text>
              <View className={`w-6 h-6 rounded-full border items-center justify-center ${active ? "bg-primary border-primary" : "border-text-secondary/35"}`}>
                {active ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </OnboardingShell>
  );
}
