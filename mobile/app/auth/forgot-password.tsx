import React, { useState } from "react";
import { View, Text, Pressable, Alert, ScrollView } from "react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { isValidEmail } from "@/lib/validation";
import { requestPasswordReset } from "@/lib/accountApi";

export default function ForgotPasswordScreen() {
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOtp = async () => {
    if (!isValidEmail(emailOrPhone)) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(emailOrPhone);
      // The server answers the same whether or not the account exists
      Alert.alert("Check your email", "If an account exists for that address, we sent a 6-digit code.", [
        {
          text: "OK",
          onPress: () =>
            router.push({ pathname: "/auth/reset-password", params: { email: emailOrPhone.trim() } }),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "space-between" }}
        className="px-6 py-6"
        showsVerticalScrollIndicator={false}
      >
        
        {/* Top Header Row */}
        <View className="w-full">
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/auth/sign-in");
              }
            }}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            className="self-start py-2 active:opacity-60"
          >
            <ArrowLeft size={24} color="#FFFFFF" />
          </Pressable>

          <View className="mt-6 mb-8">
            <Text className="text-white text-3xl font-bold font-display tracking-tight mb-2">
              Forgot Password
            </Text>
            <Text className="text-text-secondary text-base font-sans leading-6">
              Enter your email address. We will send you a 6-digit code to reset your password.
            </Text>
          </View>

          <View>
            {error ? (
              <View className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-4">
                <Text className="text-like font-sans text-[14px] font-medium text-center">
                  {error}
                </Text>
              </View>
            ) : null}

            <TextField
              label="Email"
              placeholder="Enter your email address"
              value={emailOrPhone}
              onChangeText={setEmailOrPhone}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Action Button */}
        <View className="w-full pb-4">
          <PrimaryButton
            label="Send Verification Code"
            onPress={handleSendOtp}
            loading={loading}
          />
        </View>

      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
