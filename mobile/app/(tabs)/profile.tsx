import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { User, Edit, Bell, Globe, LogOut, Key, ArrowRight, HelpCircle, FileText } from "lucide-react-native";
import { useAppStore } from "@/lib/store";
import { ConfirmSheet } from "@/components/ConfirmSheet";

export default function MyProfileScreen() {
  const { user, signOut, isDemo } = useAppStore();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const handleLogout = async () => {
    setShowLogoutModal(false);
    await signOut();
    router.replace("/auth/sign-in");
  };

  // A menu row. With no `onPress` the row is shown as unavailable (dimmed, not pressable, labelled "Not available yet").
  const renderMenuItem = (IconComponent: any, label: string, onPress?: () => void) => {
    const unavailable = !onPress;
    return (
      <Pressable
        onPress={onPress}
        disabled={unavailable}
        accessibilityRole="button"
        accessibilityState={{ disabled: unavailable }}
        accessibilityLabel={unavailable ? `${label}, not available yet` : label}
        className={`flex-row justify-between items-center bg-bg-surface/30 border border-white/5 px-4 py-4 rounded-2xl mb-3 ${unavailable ? "opacity-50" : "active:bg-bg-surface/60"}`}
      >
        <View className="flex-row items-center">
          <View className="w-10 h-10 bg-primary/10 rounded-xl items-center justify-center mr-3.5">
            <IconComponent size={18} color="#7C5CFF" />
          </View>
          <Text className="text-white font-sans font-medium text-base">
            {label}
          </Text>
        </View>
        {unavailable ? (
          <Text className="text-text-secondary font-sans text-[12px]">Not available yet</Text>
        ) : (
          <ArrowRight size={18} color="#9A8FB8" />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }} className="px-6 py-6" showsVerticalScrollIndicator={false}>
        
        {/* Profile Card Header */}
        <View className="items-center mt-6 mb-8">
          
          {/* Avatar frame with Edit overlay */}
          <View className="relative w-24 h-24 mb-4">
            <View className="w-24 h-24 rounded-full border-2 border-primary overflow-hidden items-center justify-center">
              {user?.photos && user.photos.length > 0 ? (
                <Image source={{ uri: user.photos[0] }} className="w-full h-full object-cover" />
              ) : (
                <View className="w-full h-full bg-bg-surface items-center justify-center">
                  <User size={36} color="#9A8FB8" />
                </View>
              )}
            </View>

            {/* Pencil button overlay */}
            <Pressable
              onPress={() => router.push("/profile/edit-profile")}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary border border-bg-base items-center justify-center active:scale-95 shadow-md"
            >
              <Edit size={14} color="#FFFFFF" />
            </Pressable>
          </View>

          <Text className="text-white text-2xl font-bold font-display tracking-tight">
            {user?.name || ""}
          </Text>
          {/* No verification badge: nothing verifies members yet. Show only the account email. */}
          {user?.email ? (
            <Text className="text-text-secondary text-sm font-sans mt-0.5">{user.email}</Text>
          ) : null}
          {/* Truthful status: this is e-mail verification only. Nothing here says the person has been identity-checked. */}
          {user && !isDemo ? (
            <Text className={`text-[12px] font-sans mt-1 ${user.email_verified ? "text-text-secondary" : "text-like"}`}>
              {user.email_verified ? "Email verified" : "Email not verified"}
            </Text>
          ) : null}
        </View>

        {/* Settings Menu Sections */}
        <View className="flex-1">
          <Text className="text-white font-display text-[15px] font-bold mb-4 uppercase tracking-wider pl-1">
            General
          </Text>

          {renderMenuItem(User, "Edit Profile", () => router.push("/profile/edit-profile"))}
          {renderMenuItem(Key, "Change Password", () => router.push("/profile/change-password"))}
          {renderMenuItem(Bell, "Notification settings")}
          {renderMenuItem(Globe, "Language")}
          {renderMenuItem(HelpCircle, "Help Center", () => router.push("/profile/help-center"))}
          {renderMenuItem(FileText, "Privacy Policy", () => router.push("/profile/privacy-policy"))}

          {/* Logout Trigger */}
          <Pressable
            onPress={() => setShowLogoutModal(true)}
            className="flex-row justify-between items-center bg-bg-surface/30 border border-white/5 px-4 py-4 rounded-2xl mt-4 active:bg-bg-surface/60 border-like/10"
          >
            <View className="flex-row items-center">
              <View className="w-10 h-10 bg-like/10 rounded-xl items-center justify-center mr-3.5">
                <LogOut size={18} color="#FF2E6E" />
              </View>
              <Text className="text-like font-sans font-bold text-base">
                Logout
              </Text>
            </View>
            <ArrowRight size={18} color="#FF2E6E" />
          </Pressable>
        </View>

        {/* Modal Overlay confirm logout */}
        <ConfirmSheet
          visible={showLogoutModal}
          title="Logout Confirmation"
          description="Are you sure you want to logout of Dateza? Your active conversations and swipes will still be saved."
          actionLabel="Log Out"
          onAction={handleLogout}
          onCancel={() => setShowLogoutModal(false)}
        />

      </ScrollView>
    </SafeAreaView>
  );
}
