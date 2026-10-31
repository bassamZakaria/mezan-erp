const { withAndroidManifest } = require("expo/config-plugins");

const RESIZEABLE_ATTRIBUTE = "android:resizeableActivity";

/**
 * Expo's app config has no key for `android:resizeableActivity`, and the
 * attribute has to be declared rather than left to the platform default: a
 * non-resizeable activity is letterboxed in split-screen and in a freeform
 * window, which is what Google's large-screen quality checks reject. The
 * top-level `orientation: "default"` is what writes
 * `android:screenOrientation="unspecified"` onto MainActivity — the other half
 * of the same requirement — so both must stay set together.
 */
module.exports = function withAndroidLargeScreen(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error("with-android-large-screen: the generated manifest has no <application>.");
    application.$[RESIZEABLE_ATTRIBUTE] = "true";
    return modConfig;
  });
};
