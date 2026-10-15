// Adds what expo-widgets 57 can't: background App Intents, iOS 18 controls, and a dynamic
// car picker for the widgets. Swift sources live in plugins/native/; each brand's CarClient
// has its own file there.
//
// Must be listed BEFORE "expo-widgets" in app.json: mods run in reverse registration
// order, and this one has to run after expo-widgets has (re)written the extension.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const EXT = 'ExpoWidgetsTarget';
const NATIVE = path.join(__dirname, 'native');
// [source, name in target]. The extension's copies are renamed: the Xcode project library
// skips a file whose name is already in the project.
const FILES = {
  app: [
    ['NeutronCore.swift', 'NeutronCore.swift'],
    ['NeutronIntents.swift', 'NeutronIntents.swift'],
    ['NeutronShortcuts.swift', 'NeutronShortcuts.swift'],
    ['NeutronBrands.swift', 'NeutronBrands.swift'],
    ['ProtonCarClient.swift', 'ProtonCarClient.swift'],
  ],
  ext: [
    ['NeutronCore.swift', 'NeutronCoreWidgets.swift'],
    ['NeutronIntents.swift', 'NeutronIntentsWidgets.swift'],
    ['CarControls.swift', 'CarControls.swift'],
    ['NeutronBrands.swift', 'NeutronBrandsWidgets.swift'],
    ['ProtonCarClient.swift', 'ProtonCarClientWidgets.swift'],
  ],
};
const CAR_WIDGETS = ['CarWidget', 'CarLockWidget'];
const KEYCHAIN_GROUP = '$(AppIdentifierPrefix)com.shananyaa.neutron.shared';

function copyFiles(dir, files) {
  for (const [source, name] of files) fs.copyFileSync(path.join(NATIVE, source), path.join(dir, name));
}

const withCarIntents = (config) => {
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const root = config.modRequest.platformProjectRoot;
      const appDir = path.join(root, config.modRequest.projectName);
      const extDir = path.join(root, EXT);
      copyFiles(appDir, FILES.app);
      if (!fs.existsSync(extDir)) return config;
      copyFiles(extDir, FILES.ext);

      const index = path.join(extDir, 'index.swift');
      let src = fs.readFileSync(index, 'utf8');
      if (!src.includes('CarControlsBundle')) {
        src = src.replace('WidgetLiveActivity()', 'WidgetLiveActivity()\n    if #available(iOS 18.0, *) {\n      CarControlsBundle().body\n    }');
        fs.writeFileSync(index, src);
      }

      // The car picker is a dynamic enum ("dynamic": true in app.json); src/widgets/sync.ts sets
      // its options. expo-widgets appends " Configuration" to the title shown atop the settings.
      for (const name of CAR_WIDGETS) {
        const file = path.join(extDir, `${name}.swift`);
        if (!fs.existsSync(file)) continue;
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"Choose a car Configuration"', '"Choose a car"'));
      }

      // The extension reads the brand session from the shared Keychain group.
      const ent = path.join(extDir, `${EXT}.entitlements`);
      if (fs.existsSync(ent)) {
        let e = fs.readFileSync(ent, 'utf8');
        if (!e.includes('keychain-access-groups')) {
          e = e.replace(
            '</dict>',
            `  <key>keychain-access-groups</key>\n    <array>\n      <string>${KEYCHAIN_GROUP}</string>\n    </array>\n  </dict>`,
          );
          fs.writeFileSync(ent, e);
        }
      }
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targets = project.pbxNativeTargetSection();
    const findTarget = (name) =>
      Object.keys(targets).find((k) => typeof targets[k] === 'object' && (targets[k].name === name || targets[k].name === `"${name}"`));
    const appName = config.modRequest.projectName;
    const appTarget = findTarget(appName) ?? project.getFirstTarget().uuid;
    const extTarget = findTarget(EXT);

    const addTo = (targetUuid, groupName, files) => {
      // By folder path first: the project's root group is also named after the app.
      const groupKey = project.findPBXGroupKey({ path: groupName }) ?? project.findPBXGroupKey({ name: groupName });
      if (!groupKey) return;
      const group = project.getPBXGroupByKey(groupKey);
      for (const [, name] of files) {
        if (group.children.some((c) => c.comment === name)) continue;
        // The app's group has no folder path of its own (its files carry it, e.g.
        // "Neutron/AppDelegate.swift"); the widget extension's group does.
        const filePath = group.path ? name : `${groupName}/${name}`;
        project.addSourceFile(filePath, { target: targetUuid }, groupKey);
      }
    };
    addTo(appTarget, appName, FILES.app);
    if (extTarget) {
      addTo(extTarget, EXT, FILES.ext);
      // The app's deployment target (expo-build-properties); the extension follows it, since the
      // controls and intents are written against the same iOS floor with no availability checks.
      const buildProps = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties');
      const deploymentTarget = buildProps?.[1]?.ios?.deploymentTarget;
      // Lets the shared intents hide the extension's copies from Shortcuts.
      const listId = targets[extTarget].buildConfigurationList;
      const lists = project.pbxXCConfigurationList();
      const configs = project.pbxXCBuildConfigurationSection();
      for (const ref of lists[listId]?.buildConfigurations ?? []) {
        const settings = configs[ref.value]?.buildSettings;
        if (!settings) continue;
        settings.SWIFT_ACTIVE_COMPILATION_CONDITIONS = '"$(inherited) NEUTRON_WIDGET_EXTENSION"';
        if (deploymentTarget) settings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
      }
    }
    return config;
  });
};

module.exports = withCarIntents;
