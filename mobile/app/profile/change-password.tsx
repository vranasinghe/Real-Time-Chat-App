import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Alert } from "react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { isStrongPassword } from "@/lib/validation";
import { useAppStore } from "@/lib/store";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { PasswordStrengthChecklist } from "@/components/PasswordStrengthChecklist";

export default function ChangePasswordScreen() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isPasswordValid = isStrongPassword;
  const changePassword = useAppStore((state) => state.changePassword);

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (!isPasswordValid(newPassword)) {
      setError("New password does not meet security requirements");
      return;
    }

    setError("");
    setLoading(true);

    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert("Success", "Password changed. Your other devices have been signed out.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} className="px-6 py-6" showsVerticalScrollIndicator={false}>
        
        {/* Navigation Header */}
        <View className="w-full flex-row items-center mb-6">
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/profile");
              }
            }}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="py-2 pr-4 active:opacity-60"
          >
            <ArrowLeft size={24} color="#FFFFFF" />
          </Pressable>
          <Text className="text-white text-2xl font-bold font-display">
            Change Password
          </Text>
        </View>

        {/* Inputs */}
        <View className="flex-1 space-y-4">
          {error ? (
            <View className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-2">
              <Text className="text-like font-sans text-[14px] font-medium text-center">
                {error}
              </Text>
            </View>
          ) : null}

          <TextField
            label="Current Password"
            placeholder="Enter current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            isPassword
            autoCapitalize="none"
          />

          <TextField
            label="New Password"
            placeholder="Enter new password"
            value={newPassword}
            onChangeText={setNewPassword}
            isPassword
            autoCapitalize="none"
          />

          <TextField
            label="Confirm New Password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            isPassword
            autoCapitalize="none"
          />

          <View className="mt-3">
            <PasswordStrengthChecklist password={newPassword} />
          </View>
        </View>

        {/* Action Button */}
        <View className="mt-8 mb-4">
          <PrimaryButton
            label="Save Password"
            onPress={handleSave}
            loading={loading}
          />
        </View>

      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
