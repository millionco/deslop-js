const internalToolingConfig = {
  plugins: ["./plugins/orphan.ts"],
};

export default () => ({
  plugins: [
    "./plugins/android-secure-flag.plugin.ts",
    ["./plugins/with-directory-plugin", { enabled: true }],
    "./plugins/*.ts",
    "expo-camera",
  ],
  extra: internalToolingConfig,
});
