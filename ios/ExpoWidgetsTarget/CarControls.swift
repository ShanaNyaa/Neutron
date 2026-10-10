// Control Center controls, widget extension only; copied by plugins/with-car-intents.js.
// Controls show no dialog, so results come back as a notification.

import AppIntents
import SwiftUI
import WidgetKit
internal import ExpoWidgets

/** Asked when a control is added: which car it acts on. None means the default car. */
struct CarControlConfiguration: ControlConfigurationIntent {
  static let title: LocalizedStringResource = "Choose a Car"
  static let isDiscoverable = false
  @Parameter(title: "Car") var car: MottokarCarEntity?

  init() {}

  func perform() async throws -> some IntentResult { .result() }
}

/** The chosen car, looked up again: the copy iOS stores with the control holds an old snapshot. */
private func resolve(_ configuration: CarControlConfiguration) -> MottokarCarEntity? {
  if let id = configuration.car?.id, let car = MottokarCarEntity.all().first(where: { $0.id == id }) { return car }
  return MottokarCarEntity.defaultCar()
}

struct ChosenCar: AppIntentControlValueProvider {
  func previewValue(configuration: CarControlConfiguration) -> MottokarCarEntity? { nil }
  func currentValue(configuration: CarControlConfiguration) async throws -> MottokarCarEntity? { resolve(configuration) }
}

/** The command's name, with the car's name under it so controls for different cars can be told apart. */
private func carLabel(_ title: String, systemImage: String, car: MottokarCarEntity?) -> some View {
  Label {
    Text(title)
    Text(car?.name ?? "")
  } icon: {
    Image(systemName: systemImage)
  }
}

/**
 * Locks or unlocks, depending on the toggle's new value. One intent for both directions, since iOS
 * applies an authentication policy per intent: Face ID either way.
 */
struct SetCarLockIntent: SetValueIntent {
  static let title: LocalizedStringResource = "Lock or Unlock Car"
  static let isDiscoverable = false
  // Must be a compile-time constant (App Intents reads it at build time), so it can't follow
  // the in-app "Require Face ID" switch: Face ID every time, even with the iPhone unlocked.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  @Parameter(title: "Car") var car: MottokarCarEntity?
  @Parameter(title: "Locked") var value: Bool

  init() {}
  init(car: MottokarCarEntity?) { self.car = car }

  func perform() async throws -> some IntentResult {
    _ = try await runCarIntent(value ? .lock : .unlock, car: car, notify: true, locks: value)
    return .result()
  }
}

/** One control for both: on when the car is locked; flipping it locks or unlocks. */
struct CarLockControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "com.zackryrosli.mottokar.control.lock", provider: ChosenCar()) { car in
      ControlWidgetToggle(isOn: car?.isLocked ?? true, action: SetCarLockIntent(car: car)) {
        Label {
          Text("Car Lock")
          Text(car?.name ?? "")
        } icon: {
          Image(systemName: "lock.fill")
        }
      } valueLabel: { isLocked in
        Label(isLocked ? "Locked" : "Unlocked", systemImage: isLocked ? "lock.fill" : "lock.open.fill")
      }
    }
    .displayName("Car Lock")
    .description("Shows whether your car is locked, and locks or unlocks it after Face ID.")
    .promptsForUserConfiguration()
  }
}

struct StartCarControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "com.zackryrosli.mottokar.control.engine_start", provider: ChosenCar()) { car in
      ControlWidgetButton(action: StartEngineIntent(car: car, notify: true)) { carLabel("Start", systemImage: "power", car: car) }
    }
    .displayName("Start Engine")
    .description("Starts your car for 10 minutes.")
    .promptsForUserConfiguration()
  }
}

struct ClimateCarControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "com.zackryrosli.mottokar.control.climate_on", provider: ChosenCar()) { car in
      ControlWidgetButton(action: StartClimateIntent(car: car, notify: true)) { carLabel("Climate", systemImage: "fanblades.fill", car: car) }
    }
    .displayName("Climate")
    .description("Starts climate in your car at 22°.")
    .promptsForUserConfiguration()
  }
}

struct FindCarControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "com.zackryrosli.mottokar.control.horn_lights", provider: ChosenCar()) { car in
      ControlWidgetButton(action: FindCarIntent(car: car, notify: true)) { carLabel("Find", systemImage: "headlight.low.beam.fill", car: car) }
    }
    .displayName("Find Car")
    .description("Sounds the horn and flashes the lights.")
    .promptsForUserConfiguration()
  }
}

struct CarControlsBundle: WidgetBundle {
  var body: some Widget {
    CarLockControl()
    StartCarControl()
    ClimateCarControl()
    FindCarControl()
  }
}

/**
 * Widget button targets, "mottokar:<command>:<car id>". The expo-widgets patch in patches/
 * looks this class up by name. Unlock and Start are deliberately absent (src/widgets/sync.ts).
 */
@objc(MottokarWidgetActions)
final class MottokarWidgetActions: NSObject, WidgetsNativeActions {
  static func handle(target: String) async -> Bool {
    let parts = target.split(separator: ":", maxSplits: 2).map(String.init)
    guard parts.count == 3, parts[0] == "mottokar" else { return false }
    let command: CarCommand
    switch parts[1] {
    case "lock": command = .lock
    case "climate_on": command = .climate(temp: 22)
    case "lights": command = .lights
    case "horn_lights": command = .find
    default: return false
    }
    let car = MottokarCarEntity.all().first { $0.id == parts[2] }
    _ = try? await CarCommandRunner.perform(command, on: car, notify: true, locks: parts[1] == "lock" ? true : nil)
    return true
  }
}

extension SetCarLockIntent: LiveActivityIntent {}
