import { Asset } from "expo-asset";
import type { Profile } from "./types";
import catalog from "../assets/profiles/catalog.json";

// Static requires let Metro package every photo for web, Android, and iOS,
// including the offline demo with no API server or remote image host.
const photos: Record<string, number[]> = {
  maya: [require("../assets/profiles/maya.png")],
  isla: [require("../assets/profiles/isla.png")],
  amara: [require("../assets/profiles/amara.png"), require("../assets/profiles/amara-elegant.png"), require("../assets/profiles/amara-lifestyle.png")],
  hana: [require("../assets/profiles/hana.png")],
  sofia: [require("../assets/profiles/sofia.png")],
  naomi: [require("../assets/profiles/naomi.png")],
  ivy: [require("../assets/profiles/ivy.png")],
  claire: [require("../assets/profiles/claire.png")],
  sadie: [require("../assets/profiles/sadie.png")],
  brooke: [require("../assets/profiles/brooke.png")],
  adrian: [require("../assets/profiles/adrian.png")],
  rohan: [require("../assets/profiles/rohan.png")],
  julian: [require("../assets/profiles/julian.png")],
  luca: [require("../assets/profiles/luca.png")],
  kai: [require("../assets/profiles/kai.png")],
  elias: [require("../assets/profiles/elias.png")],
};

export const SHOWCASE_PROFILES: Profile[] = catalog.map(({ key, photo_files: _photoFiles, ...profile }) => ({
  ...profile,
  id: `demo-showcase-${key}`,
  photos: photos[key].map((photo) => Asset.fromModule(photo).uri),
}));
