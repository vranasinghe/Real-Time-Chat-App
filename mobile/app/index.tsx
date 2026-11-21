import React, { useEffect } from "react";
import { View, Text, Image, Pressable, Dimensions } from "react-native";
import { router, useRootNavigationState } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useAppStore } from "@/lib/store";
import { CONFIG_ERROR } from "@/lib/config";

const { height } = Dimensions.get("window");

export default function SplashScreen() {
  const { session, profileSetupComplete, isInitialized } = useAppStore();
  const rootNavigationState = useRootNavigationState();
  const isFocused = useIsFocused();

  useEffect(() => {
    // Only when this screen is visible: screens pushed on top of it (live demo,
    // sign in, sign up) handle their own navigation after logging in.
    if (!rootNavigationState?.key || !isFocused || !isInitialized) return;

    // Auto-login logic if session exists
    if (session) {
      const timer = setTimeout(() => {
        if (profileSetupComplete) {
          router.replace("/(tabs)");
        } else {
          router.replace("/profile-setup/birthday");
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [session, profileSetupComplete, isInitialized, rootNavigationState?.key, isFocused]);

  return (
    <View style={{ flex: 1, backgroundColor: "#1A0F3D" }}>
      <View className="flex-1 items-center justify-center px-8">
        {/* Logo & Brand Section */}
        <View className="items-center justify-center" style={{ marginTop: -height * 0.04 }}>
          <Image
            source={require("../assets/images/logo.png")}
            style={{ width: 300, height: 300, borderRadius: 60, overflow: "hidden" }}
            resizeMode="contain"
          />

          {/* Tagline */}
          <Text className="text-white/80 text-base font-sans text-center px-6 -mt-2">
            Meaningful connections, made simple.
          </Text>
        </View>

        {CONFIG_ERROR ? (
          <Text className="text-red-300 text-center text-[13px] mt-6 px-4" accessibilityRole="alert">
            {CONFIG_ERROR}
          </Text>
        ) : null}

        {/* Centered Action Button */}
        <Pressable
          onPress={() => router.push("/onboarding")}
          className="bg-primary active:bg-primary-pressed rounded-full py-4 items-center justify-center shadow-lg mt-12"
          style={{ width: "72%" }}
        >
          <Text className="text-white font-sans font-semibold text-[17px]">
            Get Started
          </Text>
        </Pressable>

        {/* Live demo: real-time chat between two devices, no sign up */}
        <Pressable
          onPress={() => router.push("/live-demo")}
          className="border border-white/20 active:bg-white/5 rounded-full py-4 items-center justify-center mt-4"
          style={{ width: "72%" }}
        >
          <Text className="text-white/90 font-sans font-semibold text-[16px]">
            Live Demo · Chat on 2 devices
          </Text>
        </Pressable>

        {/* Offline demo: explore the app on this device only, no server needed */}
        <Pressable onPress={() => router.push("/demo")} className="py-3 mt-2" hitSlop={8}>
          <Text className="text-white/60 font-sans text-[14px] underline">
            Offline demo (this device only)
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
