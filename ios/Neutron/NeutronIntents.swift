// Copied into the app and widget extension by plugins/with-car-intents.js.

import AppIntents
import Foundation

func runCarIntent(_ command: CarCommand, car: NeutronCarEntity?, notify: Bool, locks: Bool? = nil) async throws -> some IntentResult & ProvidesDialog {
  let message = try await CarCommandRunner.perform(command, on: car, notify: notify, locks: locks)
  return .result(dialog: "\(message)")
}

struct LockCarIntent: AppIntent {
  static let title: LocalizedStringResource = "Lock Car"
  static let description = IntentDescription("Locks your car.")
#if NEUTRON_WIDGET_EXTENSION
  // The extension's copy only serves the controls; Shortcuts lists the app's.
  static let isDiscoverable = false
  #endif
  @Parameter(title: "Car") var car: NeutronCarEntity?
  /** Set by the Control Center control, which shows no dialog. */
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Lock \(\.$car)") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.lock, car: car, notify: notify, locks: true)
  }
}

struct UnlockCarIntent: AppIntent {
  static let title: LocalizedStringResource = "Unlock Car"
  static let description = IntentDescription("Unlocks your car. Asks for Face ID first.")
#if NEUTRON_WIDGET_EXTENSION
  static let isDiscoverable = false
  #endif
  // Must be a compile-time constant (App Intents reads it at build time), so it can't follow
  // the in-app "Require Face ID" switch: Face ID every time, even with the iPhone unlocked.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  @Parameter(title: "Car") var car: NeutronCarEntity?
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Unlock \(\.$car)") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.unlock, car: car, notify: notify, locks: false)
  }
}

struct FindCarIntent: AppIntent {
  static let title: LocalizedStringResource = "Find Car"
  static let description = IntentDescription("Sounds the horn and flashes the lights.")
#if NEUTRON_WIDGET_EXTENSION
  static let isDiscoverable = false
  #endif
  @Parameter(title: "Car") var car: NeutronCarEntity?
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Find \(\.$car)") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.find, car: car, notify: notify)
  }
}

struct StartEngineIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Engine"
  static let description = IntentDescription("Starts the engine remotely. Your iPhone has to be unlocked.")
#if NEUTRON_WIDGET_EXTENSION
  static let isDiscoverable = false
  #endif
  // Must be a compile-time constant (App Intents reads it at build time), so it can't follow
  // the in-app "Require Face ID" switch: Face ID every time, even with the iPhone unlocked.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
  @Parameter(title: "Car") var car: NeutronCarEntity?
  // Each brand fits this to the lengths it offers (CarClient.fit).
  @Parameter(title: "Minutes", default: 10, inclusiveRange: (3, 10)) var minutes: Int
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Start \(\.$car) for \(\.$minutes) minutes") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.startEngine(minutes: minutes), car: car, notify: notify)
  }
}

struct StopEngineIntent: AppIntent {
  static let title: LocalizedStringResource = "Stop Engine"
  static let description = IntentDescription("Stops a remotely started engine.")
#if NEUTRON_WIDGET_EXTENSION
  static let isDiscoverable = false
  #endif
  @Parameter(title: "Car") var car: NeutronCarEntity?
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Stop \(\.$car)") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.stopEngine, car: car, notify: notify)
  }
}

struct StartClimateIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Climate"
  static let description = IntentDescription("Cools or warms the cabin before you get in.")
#if NEUTRON_WIDGET_EXTENSION
  static let isDiscoverable = false
  #endif
  @Parameter(title: "Car") var car: NeutronCarEntity?
  @Parameter(title: "Temperature", default: 22, inclusiveRange: (16, 30)) var temperature: Int
  @Parameter(title: "Notify When Done", default: false) var notify: Bool
  static var parameterSummary: some ParameterSummary { Summary("Start climate in \(\.$car) at \(\.$temperature)°") }

  init() {}
  init(notify: Bool) { self.notify = notify }
  init(car: NeutronCarEntity?, notify: Bool) {
    self.car = car
    self.notify = notify
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    try await runCarIntent(.climate(temp: temperature), car: car, notify: notify)
  }
}

// Lets these start and update the command Live Activity (CarCommandRunner.perform); plain intents can't.
extension LockCarIntent: LiveActivityIntent {}
extension UnlockCarIntent: LiveActivityIntent {}
extension FindCarIntent: LiveActivityIntent {}
extension StartEngineIntent: LiveActivityIntent {}
extension StopEngineIntent: LiveActivityIntent {}
extension StartClimateIntent: LiveActivityIntent {}
