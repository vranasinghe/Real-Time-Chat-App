import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, Alert } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Search, X, Compass } from "lucide-react-native";
import { ProfileDetailsModal } from "@/components/ProfileDetailsModal";
import { useAppStore, Profile } from "@/lib/store";
import { Chip } from "@/components/Chip";
import { Badge } from "@/components/Badge";
import Animated, { FadeInDown } from "react-native-reanimated";

export default function ExploreScreen() {
  const { profiles, user, recordSwipe } = useAppStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

  // "Nearby" is hidden until real, consented distance filtering exists: it used to test whether the
  // profile had coordinates at all, which says nothing about how close anyone is.
  const filters = ["All", "New", "Recently Active"];

  // Filter profiles based on search query and selected filter
  const filteredProfiles = profiles.filter((p) => {
    if (p.id === user?.id) return false;
    
    const query = searchQuery.toLowerCase();
    const matchesSearch = (p.name ?? "").toLowerCase().includes(query) ||
                          (p.interests ?? []).some(i => (i ?? "").toLowerCase().includes(query));

    if (!matchesSearch) return false;

    if (activeFilter === "New") return true;
    if (activeFilter === "Recently Active") return p.is_online;
    return true;
  });

  const handleMessagePress = async (profile: Profile) => {
    setSelectedProfile(null);
    const result = await useAppStore.getState().createQuickMatch(profile);
    if (result.success) {
      router.replace("/(tabs)/chat");
    } else {
      Alert.alert(
        "Not matched yet",
        "You can chat once you've both liked each other. Try liking their profile first!"
      );
    }
  };

  const handleLikePress = async (profile: Profile) => {
    setSelectedProfile(null);
    await recordSwipe(profile.id, "like");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base">
      <View className="flex-1 px-4 py-3">
        
        {/* Header */}
        <View className="mb-4 mt-2">
          <Text className="text-white text-3xl font-bold font-display tracking-tight mb-2">
            Explore
          </Text>
          <Text className="text-text-secondary text-sm font-sans">
            Find matches by interests, name, or keywords.
          </Text>
        </View>

        {/* Search Field */}
        <View className="flex-row items-center bg-bg-surface border border-white/5 px-4 py-3.5 rounded-2xl mb-4">
          <Search size={18} color="#9A8FB8" />
          <TextInput
            placeholder="Search name, interests, tags..."
            placeholderTextColor="#9A8FB8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="text-white font-sans text-[15px] ml-3.5 flex-1 p-0"
            autoCapitalize="none"
          />
          {searchQuery ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <X size={18} color="#9A8FB8" />
            </Pressable>
          ) : null}
        </View>

        {/* Filter Chips Row */}
        <View className="mb-6">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            {filters.map((filter) => (
              <View key={filter} className="mr-2.5">
                <Chip
                  label={filter}
                  active={activeFilter === filter}
                  onPress={() => setActiveFilter(filter)}
                />
              </View>
            ))}
          </ScrollView>
        </View>

        {/* List of profiles grid (2 columns, 4 rows max) */}
        <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", width: "100%" }}>
            {filteredProfiles.map((profile, index) => (
              <Animated.View
                key={profile.id}
                entering={FadeInDown.delay(index * 60).springify()}
                style={{ width: "48%", marginBottom: 16 }}
              >
                <Pressable
                  onPress={() => setSelectedProfile(profile)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${profile.name}'s full profile`}
                  className="w-full bg-bg-surface border border-white/5 rounded-3xl overflow-hidden active:opacity-90"
                >
                  {/* Photo cover */}
                  <View style={{ aspectRatio: 1.0, width: "100%", position: "relative" }}>
                    {profile.photos?.[0] ? (
                      <Image source={{ uri: profile.photos[0] }} style={{ width: "100%", height: "100%", borderRadius: 0 }} contentFit="cover" contentPosition="top" />
                    ) : (
                      <View className="flex-1 items-center justify-center bg-bg-surface">
                        <Compass size={24} color="#9A8FB8" />
                      </View>
                    )}

                    {/* Frosted Match Badge */}
                    <View className="absolute top-3 left-3">
                      <Badge label={`${profile.match_percent}%`} />
                    </View>
                  </View>

                  {/* Profile mini info */}
                  <View className="p-3">
                    <Text className="text-white font-bold font-sans text-base" numberOfLines={1}>
                      {profile.name}, {new Date().getFullYear() - new Date(profile.birthdate).getFullYear()}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            ))}

            {filteredProfiles.length === 0 && (
              <View className="w-full py-20 items-center justify-center">
                <Text className="text-text-secondary font-sans text-center">
                  No matching profiles found.
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        <ProfileDetailsModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onLike={handleLikePress}
          onMessage={handleMessagePress}
        />

      </View>
    </SafeAreaView>
  );
}
