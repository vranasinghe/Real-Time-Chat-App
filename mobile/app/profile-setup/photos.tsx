import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Image, ActivityIndicator } from "react-native";
import { Camera, Plus, Trash2 } from "lucide-react-native";
import { OnboardingShell, goToNextStep } from "@/components/onboarding/OnboardingShell";
import { useOnboarding } from "@/lib/onboardingStore";
import { relativeImagePath } from "@/lib/onboardingApi";
import { pickProfileImage } from "@/lib/imagePicker";
import { resolveMediaUrl, useAppStore } from "@/lib/store";

/**
 * Real photos only: each one is picked on this device and uploaded to Dateza (never a stock image).
 * At least one is required; three or more are recommended. Failed uploads say why and can be retried.
 */
export default function PhotosSetupScreen() {
  const { state, save } = useOnboarding();
  const uploadPhoto = useAppStore((s) => s.uploadPhoto);
  const [photos, setPhotos] = useState<string[]>([]); // relative "/api/images/<id>" paths
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) setPhotos(state.profile.photos);
  }, [state]);

  const max = state?.photos.maximum ?? 12;
  const recommended = state?.photos.recommended ?? 3;

  const add = async () => {
    if (uploading || photos.length >= max) return;
    setError("");
    let asset;
    try {
      asset = await pickProfileImage();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pick that photo.");
      return;
    }
    if (!asset) return;
    setUploading(true);
    try {
      const url = await uploadPhoto({ uri: asset.uri, base64: asset.base64 });
      const path = relativeImagePath(url);
      if (!path) throw new Error("The server did not accept that photo. Please try another one.");
      setPhotos((current) => [...current, path]);
    } catch (e) {
      setError(e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const remove = (index: number) => setPhotos((current) => current.filter((_, i) => i !== index));

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      goToNextStep(await save("photos", { photos }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your photos.");
    } finally {
      setSaving(false);
    }
  };

  const slots = Math.max(recommended, photos.length + (photos.length < max ? 1 : 0));

  return (
    <OnboardingShell
      step="photos"
      title="Add your photos"
      subtitle={`Add at least one photo of yourself (${recommended} or more is best). Photos must be of you.`}
      onNext={submit}
      canNext={photos.length >= 1 && !uploading}
      loading={saving}
      error={error}
      nextLabel={photos.length >= recommended ? "Continue" : `Continue (${photos.length}/${recommended})`}
    >
      <View className="flex-row flex-wrap" style={{ marginHorizontal: -6 }}>
        {Array.from({ length: slots }).map((_, i) => {
          const photo = photos[i];
          const isNext = i === photos.length;
          return (
            <View key={i} style={{ width: "33.33%", aspectRatio: 3 / 4, padding: 6 }}>
              <Pressable
                onPress={() => (photo ? remove(i) : isNext ? add() : undefined)}
                accessibilityRole="button"
                accessibilityLabel={photo ? `Remove photo ${i + 1}` : `Add photo ${i + 1}`}
                className="w-full h-full rounded-2xl border border-dashed border-white/10 bg-bg-surface overflow-hidden items-center justify-center active:opacity-90"
              >
                {photo ? (
                  <>
                    <Image source={{ uri: resolveMediaUrl(photo) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                    <View className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-like/90 items-center justify-center">
                      <Trash2 size={12} color="#FFFFFF" />
                    </View>
                  </>
                ) : isNext && uploading ? (
                  <ActivityIndicator color="#7C5CFF" />
                ) : isNext ? (
                  i === 0 ? <Camera size={26} color="#7C5CFF" strokeWidth={1.5} /> : <Plus size={22} color="#9A8FB8" />
                ) : (
                  <Plus size={18} color="#4B4466" />
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text className="text-text-secondary font-sans text-[12px] mt-2">
        Tap an empty box to add a photo, or a photo to remove it. {photos.length}/{max} added.
      </Text>
    </OnboardingShell>
  );
}
