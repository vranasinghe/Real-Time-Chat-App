// The app is designed as a phone-width column. On wider screens (desktop browsers,
// tablets) it is centred in a column of at most MAX_APP_WIDTH instead of stretching.

import { Dimensions } from "react-native";

export const MAX_APP_WIDTH = 560;

/** Width the app actually renders at (read once at load; the frame itself is reactive). */
export const getAppWidth = (): number => Math.min(Dimensions.get("window").width, MAX_APP_WIDTH);
