const internalToolingConfig = {
  plugins: ["./plugins/orphan.ts"],
};

export default () => ({
  plugins: [
    `./plugins/android-secure-flag.plugin.ts`,
    ["./plugins/with-directory-plugin", { enabled: true }],
    "./plugins/*.ts",
    "/plugins/orphan.ts",
    ["./plugins/orphan.ts".replace("orphan", "orphan"), { enabled: true }],
    "expo-camera",
  ],
  extra: internalToolingConfig,
});
