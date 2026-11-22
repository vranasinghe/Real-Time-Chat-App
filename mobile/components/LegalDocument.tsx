import React from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

export interface LegalSection {
  heading: string;
  body: string;
}

/** Shared page for the policy screens. The text is DRAFT until it has had legal review. */
export function LegalDocument({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <View className="flex-1 px-6 py-6">
        <View className="w-full flex-row items-center mb-6">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="py-2 pr-4 active:opacity-60"
          >
            <ArrowLeft size={24} color="#FFFFFF" />
          </Pressable>
          <Text accessibilityRole="header" className="text-white text-2xl font-bold font-display ml-2">{title}</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
          <View className="bg-primary/10 border border-primary/25 rounded-2xl p-4 mb-6">
            <Text className="text-white font-sans font-semibold text-[14px] mb-1">Draft, pending legal review</Text>
            <Text className="text-text-secondary font-sans text-[13px] leading-5">
              This text describes how Dateza works today. It has not been reviewed by a lawyer yet and has no effective date. It will be replaced by the final version, and you will be asked to accept that version.
            </Text>
          </View>
          {sections.map((s) => (
            <View key={s.heading}>
              <Text accessibilityRole="header" className="text-white font-sans font-bold text-base mb-2">{s.heading}</Text>
              <Text className="text-text-secondary font-sans text-[14px] leading-6 mb-6">{s.body}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
