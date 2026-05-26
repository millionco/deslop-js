const internalToolingConfig = {
  plugins: ["./plugins/false-positive-target.ts"],
};

export default () => ({
  plugins: [
    `./plugins/template-literal-plugin.ts`,
    ["./plugins/directory-index-plugin", { enabled: true }],
    "./plugins/*.ts",
    "/plugins/false-positive-target.ts",
    ["./plugins/false-positive-target.ts".replace("target", "target"), { enabled: true }],
    "expo-camera",
  ],
  extra: internalToolingConfig,
});
