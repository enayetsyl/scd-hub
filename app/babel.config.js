// NOTE: NativeWind v4 is present in package.json per the stack decision
// (ADR-010/014), but its Babel/Metro transform is intentionally NOT wired here.
// On this Windows host (no watchman) NativeWind's css-interop transformer wraps
// every module's Babel pass and makes the cold Metro web bundle hang for 30+ min.
// The UI is styled with the themed StyleSheet system in src/theme + src/components.
// To re-enable NativeWind (recommended on a watchman platform / CI):
//   presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"]
// and wrap the Metro config with withNativeWind (see metro.config.js).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // react-native-reanimated/plugin powers the drawer navigator's animations and
    // MUST be the LAST plugin in the list (its own hard requirement). This is the
    // lightweight Babel plugin only — unrelated to the disabled NativeWind transform
    // above, so it doesn't reintroduce the cold-bundle hang.
    plugins: ["react-native-reanimated/plugin"],
  };
};
