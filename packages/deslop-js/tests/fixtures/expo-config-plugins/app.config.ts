export default () => ({
  plugins: [
    "./plugins/android-secure-flag.plugin.ts",
    ["./plugins/android-day-night-theme", { enabled: true }],
    "./plugins/with-directory-plugin",
    "expo-camera",
  ],
});
