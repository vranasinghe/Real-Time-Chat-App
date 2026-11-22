import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Image } from "react-native";
import { router } from "expo-router";
import type { Href } from "expo-router";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { useOnboarding } from "@/lib/onboardingStore";
import { GENDER_LABELS, INTENTION_LABELS, INTERESTED_IN_LABELS, routeFor } from "@/lib/onboardingApi";
import type { StepId } from "@/lib/onboardingApi";
import { ageOn, parseIsoDate, todayUtc } from "@/lib/age";
import { resolveMediaUrl } from "@/lib/store";

function Row({ label, value, step }: { label: string; value: string; step: StepId }) {
  return (
    <Pressable onPress={() => router.push(routeFor(step) as Href)} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Change`} className="flex-row justify-between items-center bg-bg-surface border border-white/5 rounded-2xl px-4 py-3.5 mb-3 active:bg-white/5">
      <Text className="text-text-secondary font-sans text-[14px]">{label}</Text>
      <Text className="text-white font-sans text-[15px] ml-4 flex-1 text-right" numberOfLines={2}>{value}</Text>
    </Pressable>
  );
}

/** Last step: a summary of what will be shown. Only the server can mark the profile complete. */
export default function ReviewScreen() {
  const { state, complete, load } = useOnboarding();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void load(); // always show what the server has now
  }, [load]);

  if (!state) return <OnboardingShell step="review" title="Review" onNext={() => {}} />;
  const p = state.profile;
  const dob = p.birthdate ? parseIsoDate(p.birthdate.slice(0, 10)) : null;
  const age = dob ? ageOn(dob, todayUtc()) : null;

  const finish = async () => {
    setLoading(true);
    setError("");
    try {
      await complete();
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish your profile.");
      await load(); // the server tells which steps are still missing
    } finally {
      setLoading(false);
    }
  };

  const firstMissing = state.missing[0] as StepId | undefined;

  return (
    <OnboardingShell
      step="review"
      title="Looking good"
      subtitle="Check your profile. Tap any row to change it."
      nextLabel={state.can_complete ? "Finish" : "Continue setup"}
      onNext={state.can_complete ? finish : () => router.push(routeFor(firstMissing ?? "basics") as Href)}
      loading={loading}
      error={error}
    >
      {p.photos.length > 0 ? (
        <View className="flex-row mb-4" style={{ gap: 8 }}>
          {p.photos.slice(0, 3).map((photo) => (
            <Image key={photo} source={{ uri: resolveMediaUrl(photo) }} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: 16 }} resizeMode="cover" />
          ))}
        </View>
      ) : null}
      <Row label="Name" value={p.name || "Not set"} step="basics" />
      <Row label="Age" value={age !== null ? String(age) : "Not set"} step="birthday" />
      <Row label="Email" value={state.email.verified ? `${state.email.address} (verified)` : "Not verified yet"} step="verify_email" />
      <Row label="I am" value={p.gender ? GENDER_LABELS[p.gender] ?? p.gender : "Not set"} step="gender" />
      <Row label="Interested in" value={p.looking_for ? INTERESTED_IN_LABELS[p.looking_for] ?? p.looking_for : "Not set"} step="interested_in" />
      <Row label="Looking for" value={p.relationship_intention ? INTENTION_LABELS[p.relationship_intention] ?? p.relationship_intention : "Not shared"} step="intention" />
      <Row label="Photos" value={`${p.photos.length} added`} step="photos" />
      <Row label="Interests" value={p.interests.length ? p.interests.join(", ") : "None added"} step="interests" />
      <Row label="About you" value={p.bio ? p.bio : "Nothing added"} step="about" />
      <Row label="Age range" value={p.min_age !== null && p.max_age !== null ? `${p.min_age} to ${p.max_age}` : "Everyone"} step="preferences" />
    </OnboardingShell>
  );
}
