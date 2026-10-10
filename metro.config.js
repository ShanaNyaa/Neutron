const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro"); // make sure this import exists

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle .pem files as assets: the Proton MQTT broker's certificate is pinned from one
// (react-native-tcp-socket takes `ca: require('...pem')`).
config.resolver.assetExts = [...config.resolver.assetExts, 'pem'];

// Apply uniwind modifications before exporting
const uniwindConfig = withUniwindConfig(config, {
  // relative path to your global.css file
  cssEntryFile: "./src/global.css",
  // optional: path to typings
  dtsFile: "./src/uniwind-types.d.ts",
});

module.exports = uniwindConfig;
