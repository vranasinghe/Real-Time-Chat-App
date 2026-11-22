import React, { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { KeyboardAvoid } from "@/components/common/KeyboardAvoid";
import { isStrongPassword, isValidEmail } from "@/lib/validation";
import { getAuthConfig } from "@/lib/accountApi";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/lib/store";
import { PrimaryButton } from "@/components/PrimaryButton";
import { TextField } from "@/components/TextField";
import { PasswordStrengthChecklist } from "@/components/PasswordStrengthChecklist";
import { validateBirthdate } from "@/lib/age";
import { Check } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

const GoogleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <Path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <Path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <Path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </Svg>
);

export default function CreateAccountScreen() {
  const [fullName, setFullName] = useState("");
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const signUpStore = useAppStore((state) => state.signUp);
  const signInWithGoogle = useAppStore((state) => state.signInWithGoogle);

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);
    try {
      const success = await signInWithGoogle();
      setLoading(false);
      if (success) {
        const setupComplete = useAppStore.getState().profileSetupComplete;
        router.replace(setupComplete ? "/(tabs)" : "/profile-setup");
      }
    } catch (e: any) {
      setLoading(false);
      setError(e.message || "Google Sign-In failed.");
    }
  };

  // Quick strength validation for routing allowance
  const isPasswordValid = isStrongPassword;

  const handleSignUp = async () => {
    if (!fullName || !emailOrPhone || !password) {
      setError("Please fill in all fields");
      return;
    }

    if (!isValidEmail(emailOrPhone)) {
      setError("Please enter a valid email address");
      return;
    }

    if (!isPasswordValid(password)) {
      setError("Password does not meet strength requirements");
      return;
    }

    // The date of birth is checked here for quick feedback; the server checks it again and decides.
    const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const dob = validateBirthdate(iso);
    if (!dob.ok) {
      setError(dob.message);
      return;
    }
    if (!accepted) {
      setError("Please accept the Terms of Service and the Privacy Policy to continue.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const { policies } = await getAuthConfig();
      if (!policies) {
        setLoading(false);
        setError("Can't reach the server. Check your connection and try again.");
        return;
      }
      const success = await signUpStore(emailOrPhone, password, fullName, iso, policies);
      setLoading(false);
      if (success) {
        // The server decides what is still missing (e-mail code, photos, ...) and onboarding resumes from there.
        router.replace("/profile-setup");
      } else {
        setError("Sign up failed. Please try again.");
      }
    } catch (e: any) {
      setLoading(false);
      setError(e.message || "An error occurred during sign up");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <KeyboardAvoid>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }} className="px-6 py-6">
        <View className="flex-1 justify-between">
          
          {/* Header */}
          <View className="mt-6 mb-8">
            <Text className="text-white text-3xl font-bold font-display tracking-tight mb-2">
              Create Account
            </Text>
            <Text className="text-text-secondary text-base font-sans leading-6">
              Join Dateza to find genuine, verified connections.
            </Text>
          </View>

          {/* Form */}
          <View className="mb-6">
            {error ? (
              <View className="bg-like/10 border border-like/25 rounded-2xl p-4 mb-4">
                <Text className="text-like font-sans text-[14px] font-medium text-center">
                  {error}
                </Text>
              </View>
            ) : null}

            <TextField
              label="Full Name"
              placeholder="Enter your full name"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />

            <TextField
              label="Email"
              placeholder="Enter your email address"
              value={emailOrPhone}
              onChangeText={setEmailOrPhone}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextField
              label="Password"
              placeholder="Create a strong password"
              value={password}
              onChangeText={setPassword}
              isPassword
              autoCapitalize="none"
            />

            <View className="mt-3">
              <PasswordStrengthChecklist password={password} />
            </View>

            <Text className="text-text-secondary font-sans font-medium text-[14px] mt-5 mb-2">Date of birth</Text>
            <View className="flex-row" style={{ gap: 12 }}>
              <View className="flex-1">
                <TextField label="Day" placeholder="DD" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
              </View>
              <View className="flex-1">
                <TextField label="Month" placeholder="MM" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} />
              </View>
              <View className="flex-1">
                <TextField label="Year" placeholder="YYYY" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
              </View>
            </View>
            <Text className="text-text-secondary font-sans text-[12px] leading-5 -mt-1 mb-2">
              You must be at least 18. Your birth date is never shown to others, only your age.
            </Text>

            <Pressable
              onPress={() => setAccepted((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
              accessibilityLabel="I am 18 or older and accept the Terms of Service and the Privacy Policy"
              className="flex-row items-start mt-3"
            >
              <View className={`w-6 h-6 rounded-md border items-center justify-center mr-3 mt-0.5 ${accepted ? "bg-primary border-primary" : "border-text-secondary/40"}`}>
                {accepted ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
              </View>
              <Text className="flex-1 text-text-secondary font-sans text-[13px] leading-5">
                I am 18 or older and I accept the{" "}
                <Text className="text-primary underline" onPress={() => router.push("/profile/terms")}>Terms of Service</Text>
                {" "}and the{" "}
                <Text className="text-primary underline" onPress={() => router.push("/profile/privacy-policy")}>Privacy Policy</Text>
                . Both are drafts that are still being reviewed.
              </Text>
            </Pressable>
          </View>

          {/* Sign Up Actions */}
          <View className="mb-6">
            <PrimaryButton
              label="Sign Up"
              onPress={handleSignUp}
              loading={loading}
            />

            <View className="flex-row items-center justify-center my-6">
              <View className="flex-1 h-[1px] bg-text-secondary/10" />
              <Text className="text-text-secondary font-sans text-[12px] font-semibold mx-4 uppercase tracking-wider">
                Or Continue With
              </Text>
              <View className="flex-1 h-[1px] bg-text-secondary/10" />
            </View>

            {/* Social Buttons */}
            <View className="flex-row justify-center" style={{ gap: 16 }}>
              <Pressable
                onPress={handleGoogleSignIn}
                style={{ width: 64, height: 54 }}
                className="bg-bg-surface border border-text-secondary/10 active:bg-text-secondary/5 rounded-2xl items-center justify-center"
              >
                <GoogleIcon />
              </Pressable>

            </View>
          </View>

          {/* Footer */}
          <View className="items-center pb-4 flex-row justify-center">
            <Text className="text-text-secondary font-sans text-[15px]">
              Already have an account?{" "}
            </Text>
            <Pressable onPress={() => router.push("/auth/sign-in")}>
              <Text className="text-primary font-sans font-bold text-[15px]">
                Sign In
              </Text>
            </Pressable>
          </View>

        </View>
      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}
