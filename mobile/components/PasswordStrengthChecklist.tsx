import React from "react";
import { View, Text } from "react-native";
import { Check, Circle } from "lucide-react-native";
import { passwordChecks } from "@/lib/validation";

interface PasswordStrengthChecklistProps {
  password?: string;
}

export function PasswordStrengthChecklist({ password = "" }: PasswordStrengthChecklistProps) {
  const checks = passwordChecks(password);

  return (
    <View className="bg-bg-surface border border-text-secondary/10 rounded-2xl p-4 w-full mb-6">
      <Text className="text-text-secondary font-sans font-medium text-[13px] mb-3 uppercase tracking-wider">
        Password Requirements
      </Text>
      <View className="space-y-2.5">
        {checks.map((check) => (
          <View key={check.id} className="flex-row items-center my-1">
            {check.satisfied ? (
              <View className="w-5 h-5 rounded-full bg-online/20 items-center justify-center mr-3">
                <Check size={12} color="#22C55E" strokeWidth={3} />
              </View>
            ) : (
              <View className="w-5 h-5 rounded-full bg-text-secondary/10 items-center justify-center mr-3">
                <Circle size={10} color="#9A8FB8" strokeWidth={3} />
              </View>
            )}
            <Text
              className={`font-sans text-[14px] ${
                check.satisfied ? "text-white" : "text-text-secondary"
              }`}
            >
              {check.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
