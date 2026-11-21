import React, { useState, useEffect } from "react";
import { View, Text, Pressable, Alert, ScrollView } from "react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { OtpInput } from "@/components/OtpInput";
import { ApiError } from "@/lib/api";
import { confirmEmailCode, requestEmailCode } from "@/lib/accountApi";

const RESEND_SECONDS = 60;

export default function VerifyCodeScreen() {
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Countdown timer logic
  useEffect(() => {
    if (countdown === 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const sendCode = async (isResend: boolean) => {
    setError("");
    try {
      await requestEmailCode();
      setInfo(isResend ? "A new code is on its way." : "We emailed you a 6-digit code.");
      setCountdown(RESEND_SECONDS);
    } catch (e) {
      // 429 = a code was sent a moment ago (e.g. screen reopened): that is fine
      if (e instanceof ApiError && e.status === 429) {
        setInfo("A code was already sent. Check your email.");
      } else {
        setError(e instanceof Error ? e.message : "Could not send the code.");
      }
    }
  };

  useEffect(() => {
    void sendCode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = async () => {
    if (code.length < 6) {
      setError("Please enter the complete 6-digit code");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await confirmEmailCode(code);
      router.replace("/profile-setup/birthday");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify the code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    if (countdown > 0) return;
    void sendCode(true);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "space-between" }}
        className="px-6 py-6"
        showsVerticalScrollIndicator={false}
      >
        
        {/* Top Section */}
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
              Verify Code
            </Text>
            <Text className="text-text-secondary text-base font-sans leading-6">
              Enter the 6-digit code we emailed you to confirm your address.
            </Text>
          </View>

          <View className="items-center py-6">
            {error ? (
              <View className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-6 w-full">
                <Text className="text-like font-sans text-[14px] font-medium text-center">
                  {error}
                </Text>
              </View>
            ) : null}

            {info && !error ? (
              <Text className="text-text-secondary font-sans text-[14px] mb-4 text-center">{info}</Text>
            ) : null}

            <OtpInput codeLength={6} onCodeChanged={setCode} />

            {/* Countdown / Resend Option */}
            <View className="mt-8 flex-row items-center justify-center">
              {countdown > 0 ? (
                <Text className="text-text-secondary font-sans text-[14px]">
                  You can resend the code in{" "}
                  <Text className="text-primary font-bold">{countdown}s</Text>
                </Text>
              ) : (
                <Pressable onPress={handleResend} className="py-1">
                  <Text className="text-primary font-sans font-bold text-[14px] underline">
                    Resend Code
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Action Button */}
        <View className="w-full pb-4">
          <PrimaryButton
            label="Confirm"
            onPress={handleConfirm}
            loading={loading}
          />
          <Pressable onPress={() => router.replace("/profile-setup/birthday")} className="py-4 items-center" accessibilityRole="button">
            <Text className="text-text-secondary font-sans text-[14px] underline">Verify later</Text>
          </Pressable>
        </View>

      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
