import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAppStore } from "@/lib/store";
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

const FacebookIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
    <Path fill="#1877F2" d="M24 12C24 5.373 18.627 0 12 0S0 5.373 0 12c0 5.99 4.388 10.954 10.125 11.854V15.47H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.469h-2.796v8.385C19.612 22.954 24 17.99 24 12Z" />
    <Path fill="#FFFFFF" d="m16.671 15.469.532-3.469h-3.328V9.749c0-.949.465-1.874 1.955-1.874h1.514V4.922s-1.374-.235-2.686-.235c-2.741 0-4.533 1.662-4.533 4.669V12H7.078v3.469h3.047v8.385a12.1 12.1 0 0 0 3.75 0v-8.385h2.796Z" />
  </Svg>
);

export default function GetStartedScreen() {
  const signInWithGoogle = useAppStore((state) => state.signInWithGoogle);
  const { width, height } = useWindowDimensions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const success = await signInWithGoogle();
      if (success) {
        const setupComplete = useAppStore.getState().profileSetupComplete;
        if (setupComplete) {
          router.replace("/(tabs)");
        } else {
          router.replace("/profile-setup");
        }
      }
    } catch (e: any) {
      setError(e.message || "Google Sign-In failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>Dateza<Text style={styles.brandDot}>.</Text></Text>
        </View>

        {/* Title Section */}
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[styles.title, width < 360 && styles.smallTitle]}>
            {"Let's get started."}
          </Text>
          <Text style={styles.subtitle}>
            Discover love, your way with Dateza.
          </Text>
        </View>

        {/* Dynamic Image Frame */}
        <View style={[styles.imageFrame, { maxWidth: Math.min(360, Math.max(240, height - 420)) }]}>
          <Image
            style={styles.image}
            contentFit="cover"
            contentPosition="center"
            accessible={false}
            source={require("../../assets/images/get-started-bg.jpg")}
          />
        </View>

        {/* Action Controls */}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign Up with Email"
            style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.pressed]}
            onPress={() => router.push("/auth/create-account")}
          >
            <Text style={styles.buttonText}>Sign Up with Email</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.rule} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.rule} />
          </View>

          {/* Social Sign Up Rows */}
          <View>
            {/* Google button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign Up with Google"
              accessibilityState={{ disabled: loading, busy: loading }}
              disabled={loading}
              onPress={handleGoogleSignIn}
              style={({ pressed }) => [styles.button, styles.googleButton, (pressed || loading) && styles.pressed]}
            >
              {loading ? <ActivityIndicator color={colors.text} /> : <>
                <GoogleIcon />
                <Text style={styles.buttonText}>Sign Up with Google</Text>
              </>}
            </Pressable>

          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign Up with Facebook, not configured yet"
            accessibilityState={{ disabled: true }}
            disabled
            style={[styles.button, styles.googleButton, styles.facebookButton]}
          >
            <FacebookIcon />
            <Text style={styles.buttonText}>Sign Up with Facebook</Text>
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.signInRow}>
            <Text style={styles.accountPrompt}>Already have an account?</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in to your existing account"
              onPress={() => router.push("/auth/sign-in")}
              style={({ pressed }) => [styles.signIn, pressed && styles.pressed]}
            >
              <Text style={styles.signInText}>Sign In</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/live-demo")}
            style={({ pressed }) => [styles.signIn, { alignSelf: "center" }, pressed && styles.pressed]}
          >
            <Text style={styles.signInText}>Try the live demo · Alex & Elena</Text>
          </Pressable>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const colors = {
  background: "#0E0720", surface: "#1B1035", primary: "#7C5CFF",
  text: "#FFFFFF", secondary: "#B9AECE", border: "#514365", error: "#FFADBE",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 16, paddingBottom: 32 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  brand: { color: colors.text, fontFamily: "SpaceGrotesk_700Bold", fontSize: 25, letterSpacing: -0.6 },
  brandDot: { color: colors.primary },
  signInRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", marginTop: 4, columnGap: 4 },
  accountPrompt: { color: colors.secondary, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  signIn: { minHeight: 48, paddingHorizontal: 8, justifyContent: "center" },
  signInText: { color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14, textDecorationLine: "underline" },
  intro: { marginTop: 28, marginBottom: 24, gap: 8 },
  title: { color: colors.text, fontFamily: "SpaceGrotesk_700Bold", fontSize: 32, lineHeight: 40, letterSpacing: -0.8 },
  smallTitle: { fontSize: 28, lineHeight: 36 },
  subtitle: { color: colors.secondary, fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 24 },
  imageFrame: { width: "100%", maxWidth: 360, aspectRatio: 1, alignSelf: "center", overflow: "hidden", borderRadius: 16, backgroundColor: colors.surface },
  image: { width: "100%", height: "100%" },
  actions: { marginTop: 24 },
  button: { minHeight: 56, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  primaryButton: { backgroundColor: colors.primary },
  googleButton: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  facebookButton: { marginTop: 12, opacity: 0.6 },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 24, color: colors.text, textAlign: "center", flexShrink: 1 },
  divider: { flexDirection: "row", alignItems: "center", gap: 16, marginVertical: 12 },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.secondary, fontFamily: "Inter_400Regular", fontSize: 13 },
  pressed: { opacity: 0.72 },
  error: { color: colors.error, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22, marginTop: 16 },
});
