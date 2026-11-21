import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { isStrongPassword } from "@/lib/validation";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { OtpInput } from "@/components/OtpInput";
import { confirmPasswordReset } from "@/lib/accountApi";
import { PasswordStrengthChecklist } from "@/components/PasswordStrengthChecklist";
import { ConfirmSheet } from "@/components/ConfirmSheet";

export default function ResetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const isPasswordValid = isStrongPassword;

  const handleResetPassword = async () => {
    if (!email) {
      setError("Start again from Forgot Password");
      return;
    }
    if (code.length < 6) {
      setError("Enter the 6-digit code from your email");
      return;
    }
    if (!password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!isPasswordValid(password)) {
      setError("Password does not meet strength requirements");
      return;
    }

    setError("");
    setLoading(true);
    try {
      await confirmPasswordReset(email, code, password);
      setShowSuccessModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the password.");
    } finally {
      setLoading(false);
    }
  };

  const handleModalConfirm = () => {
    setShowSuccessModal(false);
    // Route back to sign in
    router.replace("/auth/sign-in");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} className="px-6 py-6">
        <View className="flex-1 justify-between">
          
          {/* Header */}
          <View className="mt-6 mb-8">
            <Text className="text-white text-3xl font-bold font-display tracking-tight mb-2">
              Set New Password
            </Text>
            <Text className="text-text-secondary text-base font-sans leading-6">
              Enter the code we emailed you and choose a new password. Other devices will be signed out.
            </Text>
          </View>

          {/* Form */}
          <View className="mb-8">
            {error ? (
              <View className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-4">
                <Text className="text-like font-sans text-[14px] font-medium text-center">
                  {error}
                </Text>
              </View>
            ) : null}

            <Text className="text-text-secondary font-sans font-medium text-[14px] mb-2">Verification code</Text>
            <View className="items-center mb-6">
              <OtpInput codeLength={6} onCodeChanged={setCode} />
            </View>

            <TextField
              label="New Password"
              placeholder="Enter new password"
              value={password}
              onChangeText={setPassword}
              isPassword
              autoCapitalize="none"
            />

            <TextField
              label="Confirm Password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              isPassword
              autoCapitalize="none"
            />

            <View className="mt-4">
              <PasswordStrengthChecklist password={password} />
            </View>
          </View>

          {/* Action Button */}
          <View className="mb-6">
            <PrimaryButton
              label="Set New Password"
              onPress={handleResetPassword}
              loading={loading}
            />
          </View>

          {/* Success Modal Sheet Overlay */}
          <ConfirmSheet
            visible={showSuccessModal}
            title="Password Changed!"
            description="Your password has been successfully reset. You can now use your new password to sign in."
            actionLabel="Go to Sign In"
            onAction={handleModalConfirm}
            onCancel={handleModalConfirm} // Both buttons return to sign in
          />

        </View>
      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
