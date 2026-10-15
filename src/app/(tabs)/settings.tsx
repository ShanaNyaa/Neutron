import { router } from "expo-router";
import Constants from "expo-constants";
import { useState } from "react";
import { Linking, View } from "react-native";
import { Uniwind, useUniwind } from "uniwind";
import { useShallow } from "zustand/react/shallow";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { Group, PanelRow } from "@/components/panel";
import { Icon, Page, Section, Toggle } from "@/components/ui";
import { useConnections } from "@/core/connections";
import { isIOS } from "@/core/shared";
import { confirmWithBiometrics, setBiometricsRequired, useBiometrics, useIsBiometricsRequired } from "@/lib/confirm";
import { setDeveloperMode, useIsDeveloperMode } from "@/lib/developer-mode";

const THEMES = [
  { id: "system", label: "System", icon: "phone-portrait-outline" },
  { id: "light", label: "Light", icon: "sunny-outline" },
  { id: "dark", label: "Dark", icon: "moon-outline" },
] as const;

export default function Settings() {
  const { theme, hasAdaptiveThemes } = useUniwind();
  const active = hasAdaptiveThemes ? "system" : theme;
  const { connections, removeConnection } = useConnections(useShallow((s) => ({ connections: s.connections, removeConnection: s.removeConnection })));
  const bio = useBiometrics();
  const required = useIsBiometricsRequired();
  const isDeveloper = useIsDeveloperMode();

  // Turning it off needs biometrics too, or anyone holding the unlocked phone could.
  const toggleBiometrics = (next: boolean) => {
    if (next) return setBiometricsRequired(true);
    confirmWithBiometrics(`Turn off ${bio.name} for car controls`).then((ok) => {
      if (ok) return setBiometricsRequired(false);
    });
  };

  const [isWiping, setIsWiping] = useState(false);
  const wipe = async () => {
    for (const c of connections) await removeConnection(c.id);
  };

  return (
    <>
      <Page title="Settings">
        <Section title="Appearance">
          <Group>
            {THEMES.map((t) => (
              <PanelRow
                key={t.id}
                icon={t.icon}
                label={t.label}
                isChevronVisible={false}
                trailing={
                  active === t.id ? (
                    <View accessible accessibilityLabel="Selected">
                      <Icon name="checkmark" size={20} colorClassName="accent-foreground" />
                    </View>
                  ) : undefined
                }
                onPress={() => Uniwind.setTheme(t.id)}
              />
            ))}
          </Group>
        </Section>

        <Section title="Security" className="mt-3">
          <Group>
            <PanelRow
              icon="scan-outline"
              label={`Require ${bio.name}`}
              detail={
                bio.isReady
                  ? "Asked after you press and hold to unlock, start the engine, open the boot or open the windows. Shortcuts and Control Center always ask before unlocking or starting."
                  : `${bio.name} isn't set up on this device. Unlocking and starting still need a press and hold.`
              }
              trailing={
                <Toggle
                  isOn={bio.isReady && required}
                  isDisabled={!bio.isReady}
                  onValueChange={toggleBiometrics}
                  accessibilityLabel={`Require ${bio.name}`}
                />
              }
            />
          </Group>
        </Section>

        <Section title="Privacy" className="mt-3">
          <Group>
            <PanelRow
              icon="shield-checkmark-outline"
              label="Credentials stay on this device"
              detail={
                isIOS
                  ? "Sign-ins and your car PIN are kept in the iOS Keychain, shared only with Neutron's widgets and Shortcuts, and sent only to each brand's own servers. The PIN can only be read while your iPhone is unlocked."
                  : "Sign-ins and your car PIN are kept in the Android Keystore and sent only to each brand's own servers."
              }
            />
          </Group>
        </Section>

        {connections.length ? (
          <Section title="Danger Zone" className="mt-3">
            <Group>
              <PanelRow icon="trash-outline" label="Remove All Connections" isDestructive onPress={() => setIsWiping(true)} />
            </Group>
          </Section>
        ) : null}

        <Section title="Developer" className="mt-3">
          <Group>
            <PanelRow
              icon="code-slash-outline"
              label="Developer Mode"
              detail="Shows tools for troubleshooting: debug logs and a simulator."
              trailing={<Toggle isOn={isDeveloper} onValueChange={setDeveloperMode} accessibilityLabel="Developer Mode" />}
            />
            {/* Separate children, not a fragment: Group draws a divider between each. */}
            {isDeveloper ? (
              <PanelRow
                icon="document-text-outline"
                label="Debug Logs"
                detail="Requests, car messages and commands, with personal details hidden."
                onPress={() => router.push("/logs")}
              />
            ) : null}
            {isDeveloper ? (
              <PanelRow
                icon="play-circle-outline"
                label="Simulator"
                detail="Live Activities, command progress and notifications."
                onPress={() => router.push("/debug")}
              />
            ) : null}
          </Group>
        </Section>

        <Section title="About" className="mt-3">
          <Group>
            <PanelRow icon="information-circle-outline" label="Version" value={Constants.expoConfig?.version ?? "1.0.0"} />
            <PanelRow
              icon="logo-github"
              label="GitHub Repository"
              detail="github.com/ShanaNyaa/neutron"
              onPress={() => Linking.openURL("https://github.com/ShanaNyaa/neutron")}
            />
            <PanelRow
              icon="heart-outline"
              label="Based on"
              detail="Mottokar by Zackry Rosli"
              onPress={() => Linking.openURL("https://github.com/zekr89/mottokar")}
            />
          </Group>
        </Section>
      </Page>
      <ConfirmSheet
        isVisible={isWiping}
        title="Remove All Connections?"
        message="Every sign-in, saved PIN and car stored on this device is deleted."
        action="Remove All"
        pendingAction="Removing All…"
        onConfirm={wipe}
        onClose={() => setIsWiping(false)}
      />
    </>
  );
}
