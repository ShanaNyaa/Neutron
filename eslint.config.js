// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "src/uniwind-types.d.ts"],
  },
  {
    rules: {
      quotes: ["error", "double", { avoidEscape: true }],
    },
  },
]);
