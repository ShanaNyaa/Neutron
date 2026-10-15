// App target only: one AppShortcutsProvider per app. Copied by plugins/with-car-intents.js.
// Phrases must include the app name.

import AppIntents

struct NeutronShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: LockCarIntent(),
      phrases: ["Lock my car with \(.applicationName)", "Lock \(\.$car) with \(.applicationName)"],
      shortTitle: "Lock Car",
      systemImageName: "lock.fill"
    )
    AppShortcut(
      intent: UnlockCarIntent(),
      phrases: ["Unlock my car with \(.applicationName)", "Unlock \(\.$car) with \(.applicationName)"],
      shortTitle: "Unlock Car",
      systemImageName: "lock.open.fill"
    )
    AppShortcut(
      intent: FindCarIntent(),
      phrases: ["Find my car with \(.applicationName)", "Find \(\.$car) with \(.applicationName)"],
      shortTitle: "Find Car",
      systemImageName: "headlight.low.beam.fill"
    )
    AppShortcut(
      intent: StartEngineIntent(),
      phrases: ["Start my car with \(.applicationName)", "Start \(\.$car) with \(.applicationName)"],
      shortTitle: "Start Engine",
      systemImageName: "power"
    )
    AppShortcut(
      intent: StartClimateIntent(),
      phrases: ["Cool my car with \(.applicationName)", "Start climate with \(.applicationName)"],
      shortTitle: "Start Climate",
      systemImageName: "fanblades.fill"
    )
    AppShortcut(
      intent: StopEngineIntent(),
      phrases: ["Stop my car with \(.applicationName)"],
      shortTitle: "Stop Engine",
      systemImageName: "power.circle"
    )
  }
}
