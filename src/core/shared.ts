import { Platform } from "react-native";

/** Must match the entitlements in app.json and the iOS extension targets. */
export const APP_GROUP = "group.com.zackryrosli.mottokar";
/** Team ID prefix + the group in app.json's keychain-access-groups. */
export const KEYCHAIN_GROUP = "PAJK9L7KYM.com.zackryrosli.mottokar.shared";

export const isIOS = Platform.OS === "ios";
