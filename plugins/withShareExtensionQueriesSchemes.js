// Custom Expo config plugin: adds LSApplicationQueriesSchemes to the
// share extension's Info.plist so canOpenURL("spot://") works on iOS 18+.
//
// The expo-share-intent plugin generates the extension's Info.plist but
// does NOT include LSApplicationQueriesSchemes. On iOS 18+,
// UIApplication.canOpenURL("spot://") returns false without this key,
// causing the share extension to show an error alert and hang Instagram.
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withShareExtensionQueriesSchemes(config, { extensionName = "SpotShare" } = {}) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const infoPlistPath = path.join(
        config.modRequest.platformProjectRoot,
        extensionName,
        `${extensionName}-Info.plist`
      );

      if (!fs.existsSync(infoPlistPath)) {
        console.warn(
          `[withShareExtensionQueriesSchemes] Extension Info.plist not found at ${infoPlistPath}. ` +
          `Make sure "expo-share-intent" runs before this plugin.`
        );
        return config;
      }

      let plistContent = fs.readFileSync(infoPlistPath, "utf8");

      // Only add if not already present
      if (!plistContent.includes("LSApplicationQueriesSchemes")) {
        // Insert before the closing </dict> that precedes </plist> (top-level dict)
        plistContent = plistContent.replace(
          /(?=<\/dict>\s*<\/plist>\s*$)/,
          "\t<key>LSApplicationQueriesSchemes</key>\n" +
          "\t<array>\n" +
          "\t\t<string>spot</string>\n" +
          "\t</array>\n"
        );
        fs.writeFileSync(infoPlistPath, plistContent);
        console.log(
          `[withShareExtensionQueriesSchemes] Added LSApplicationQueriesSchemes to ${infoPlistPath}`
        );
      } else {
        console.log(
          `[withShareExtensionQueriesSchemes] LSApplicationQueriesSchemes already present`
        );
      }

      return config;
    },
  ]);
}

module.exports = withShareExtensionQueriesSchemes;
