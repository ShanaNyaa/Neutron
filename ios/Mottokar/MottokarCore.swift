// Copied into the app and widget extension by plugins/with-car-intents.js.
// Brand-neutral, like src/core: brands implement CarClient in their own files and are listed in
// MottokarBrands.swift, the way src/providers/index.ts registers providers.

import ActivityKit
import AppIntents
import Foundation
import WidgetKit
import UserNotifications
internal import ExpoWidgets

// MARK: - Keychain (the same items expo-secure-store writes; see src/core/secure-kv.ts)

enum SharedKeychain {
  static let group = "PAJK9L7KYM.com.zackryrosli.mottokar.shared"
  // expo-secure-store's service for items saved without biometric protection.
  static let service = "app:no-auth"
  static let chunk = 1800

  /** secure-kv.ts `safe()`: keys may only contain alphanumerics, ".", "-" and "_". */
  static func safe(_ key: String) -> String {
    String(key.map { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "-" || $0 == "_") ? $0 : "_" })
  }

  private static func query(_ key: String) -> [String: Any] {
    let account = Data(safe(key).utf8)
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrGeneric as String: account,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: group,
    ]
  }

  private static func readRaw(_ key: String) -> String? {
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func writeRaw(_ key: String, _ value: String) {
    let q = query(key)
    let data = Data(value.utf8)
    if SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecItemNotFound {
      var add = q
      add[kSecValueData as String] = data
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
      SecItemAdd(add as CFDictionary, nil)
    }
  }

  private static func deleteRaw(_ key: String) {
    SecItemDelete(query(key) as CFDictionary)
  }

  /** secure-kv.ts `getItem`: values over 1800 characters are split into "<key>.<i>" chunks. */
  static func get(_ key: String) -> String? {
    guard let head = readRaw(key) else { return nil }
    guard head.hasPrefix("chunks:"), let count = Int(head.dropFirst(7)) else { return head }
    var parts: [String] = []
    for i in 0..<count {
      guard let part = readRaw("\(key).\(i)") else { return nil }
      parts.append(part)
    }
    return parts.joined()
  }

  /** secure-kv.ts `setItem`, same chunking. */
  static func set(_ key: String, _ value: String) {
    if let head = readRaw(key), head.hasPrefix("chunks:"), let count = Int(head.dropFirst(7)) {
      for i in 0..<count { deleteRaw("\(key).\(i)") }
    }
    guard value.count > chunk else { return writeRaw(key, value) }
    let chars = Array(value)
    let count = Int((Double(chars.count) / Double(chunk)).rounded(.up))
    for i in 0..<count {
      writeRaw("\(key).\(i)", String(chars[(i * chunk)..<min(chars.count, (i + 1) * chunk)]))
    }
    writeRaw(key, "chunks:\(count)")
  }
}

// MARK: - Cars (from the snapshot the app sends the Car widget; see src/widgets/sync.ts)

struct MottokarCarEntity: AppEntity {
  let id: String
  let name: String
  let isDefault: Bool
  let provider: String
  let connectionId: String
  let vin: String
  let pinRequired: Bool
  /** nil when the car hasn't reported it. */
  let isLocked: Bool?

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Car"
  static let defaultQuery = MottokarCarQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: isDefault ? "Default car" : nil)
  }

  static func all() -> [MottokarCarEntity] {
    guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_CarWidget_timeline"),
          let entry = timeline.last as? [String: Any],
          let props = entry["props"] as? [String: Any],
          let cars = props["cars"] as? [[String: Any]] else { return [] }
    return cars.compactMap { car in
      guard let id = car["id"] as? String, let name = car["name"] as? String else { return nil }
      // id is "<connection>/<vehicle>"; the vehicle id stands in for a VIN the app didn't send.
      let parts = id.split(separator: "/", maxSplits: 1).map(String.init)
      return MottokarCarEntity(
        id: id,
        name: name,
        isDefault: car["isDefault"] as? Bool ?? false,
        provider: car["provider"] as? String ?? "",
        connectionId: parts.first ?? "",
        vin: car["vin"] as? String ?? (parts.count > 1 ? parts[1] : ""),
        pinRequired: car["isPinRequired"] as? Bool ?? false,
        isLocked: car["isLocked"] as? Bool
      )
    }
  }

  static func defaultCar() -> MottokarCarEntity? {
    let cars = all()
    return cars.first { $0.isDefault } ?? cars.first
  }

  /** Records a lock change straight away, before the app next syncs, and refreshes widgets and controls. */
  static func setLocked(_ isLocked: Bool, carId: String) {
    guard let defaults = UserDefaults(suiteName: WidgetsStorage.appGroupIdentifier) else { return }
    for widget in ["CarWidget", "CarLockWidget"] {
      let key = "__expo_widgets_\(widget)_timeline"
      guard var timeline = defaults.array(forKey: key) as? [[String: Any]] else { continue }
      for i in timeline.indices {
        guard var props = timeline[i]["props"] as? [String: Any], var cars = props["cars"] as? [[String: Any]] else { continue }
        for j in cars.indices where cars[j]["id"] as? String == carId { cars[j]["isLocked"] = isLocked }
        props["cars"] = cars
        timeline[i]["props"] = props
      }
      defaults.set(timeline, forKey: key)
      WidgetCenter.shared.reloadTimelines(ofKind: widget)
    }
    ControlCenter.shared.reloadAllControls()
  }
}


struct MottokarCarQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [MottokarCarEntity] {
    MottokarCarEntity.all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [MottokarCarEntity] {
    MottokarCarEntity.all()
  }

  func defaultResult() async -> MottokarCarEntity? {
    MottokarCarEntity.defaultCar()
  }
}

// MARK: - Commands

enum CarCommandError: Error, CustomLocalizedStringResourceConvertible {
  case noCar
  case unsupported
  case signedOut
  case needsPin
  case pinLocked
  case wrongPin
  case brand(String)

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .noCar: "Open Mottokar and add your car first."
    case .unsupported: "Mottokar can't do this for this car from Shortcuts yet."
    case .signedOut: "Your sign-in has run out. Open Mottokar to sign in again."
    case .needsPin: "Open Mottokar and send one command with your PIN, so Shortcuts can use it."
    case .pinLocked: "Unlock your iPhone first, so Mottokar can use your PIN."
    case .wrongPin: "Your car PIN has changed. Open Mottokar and enter it again."
    case .brand(let message): "\(message)"
    }
  }
}

/**
 * A command as intent only, named by its CommandId (src/core/types.ts); each brand's CarClient turns it
 * into its own request. `label`, `symbol` and `timer` mirror the in-app command (widgets/symbols.ts).
 */
struct CarCommand {
  let id: String
  /** How long a timed command runs (engine_start). */
  var minutes: Int? = nil
  /** Target cabin temperature in °C (climate_on). */
  var temp: Int? = nil
  let done: String
  /** Confirms the command from the car's state when the brand gives no answer of its own. */
  var confirmedBy: ((CarStatus) -> Bool)? = nil
  /** Shown on the Live Activity. */
  let label: String
  let symbol: String
  /** A command that keeps running after it's sent, worded like CommandDefinition.timer. */
  var timer: (running: String, ended: String)? = nil

  static let lock = CarCommand(id: "lock", done: "Locked", confirmedBy: { $0.locked == true }, label: "Lock", symbol: "lock.fill")
  static let unlock = CarCommand(id: "unlock", done: "Unlocked", confirmedBy: { $0.locked == false }, label: "Unlock", symbol: "lock.open.fill")
  static let find = CarCommand(id: "horn_lights", done: "Horn and lights on", label: "Honk and Flash", symbol: "speaker.wave.2.fill")
  static let lights = CarCommand(id: "lights", done: "Lights flashed", label: "Flash Lights", symbol: "headlight.low.beam.fill")
  static let stopEngine = CarCommand(id: "engine_stop", done: "Engine off", confirmedBy: { $0.engineOn == false }, label: "Stop Engine", symbol: "stop.circle.fill")
  static func startEngine(minutes: Int) -> CarCommand {
    CarCommand(
      id: "engine_start", minutes: minutes, done: "Engine started for \(minutes) minutes", confirmedBy: { $0.engineOn == true },
      label: "Start Engine", symbol: "power", timer: ("The engine is running. It will be switched off automatically.", "Engine off"))
  }
  static func climate(temp: Int) -> CarCommand {
    CarCommand(id: "climate_on", temp: temp, done: "Climate on at \(temp)°", label: "Climate", symbol: "fanblades.fill")
  }
}

/** The car's state, in brand-neutral terms. */
struct CarStatus {
  let locked: Bool?
  let engineOn: Bool?
}

/** How a brand's send ended when it didn't throw (a refusal throws). */
enum CommandOutcome {
  /** The car said it did it. */
  case confirmed
  /** No answer from the car; `waited` says whether the client already waited for one. */
  case unanswered(waited: Bool)
}

/**
 * One brand's way to run commands from outside the app (Shortcuts, Control Center, widgets): the
 * native counterpart of a ProviderDefinition (src/core/provider.ts), for this one job.
 */
protocol CarClient {
  /** The app's provider id (ProviderDefinition.id) this client serves. */
  static var provider: String { get }
  /** Loads the connection's saved sign-in from the shared Keychain; throws CarCommandError.signedOut without one. */
  init(connectionId: String) throws
  /**
   * Sends `command` and waits for the car's answer if the brand gives one, calling `delivered` once
   * the command reaches the car. Throws if the car or the brand refuses it.
   */
  mutating func send(_ command: CarCommand, to car: MottokarCarEntity, delivered: () async -> Void) async throws -> CommandOutcome
  mutating func status(vin: String) async throws -> CarStatus
  /** Fits a command to what the brand accepts (say, its remote start lengths) before it's shown or sent. */
  static func fit(_ command: CarCommand) -> CarCommand
}

extension CarClient {
  static func fit(_ command: CarCommand) -> CarCommand { command }
}

/** Picks a car's client from `brands` (MottokarBrands.swift), like getProvider in src/core/registry.ts. */
enum CarClients {
  static func brand(for car: MottokarCarEntity) -> (any CarClient.Type)? {
    brands.first { $0.provider == car.provider }
  }

  static func client(for car: MottokarCarEntity) throws -> any CarClient {
    guard let brand = brand(for: car) else { throw CarCommandError.unsupported }
    return try brand.init(connectionId: car.connectionId)
  }
}

// MARK: - Live Activity (the one the app shows for its own commands)

/**
 * Mirrors ExpoWidgets' LiveActivityAttributes (node_modules/expo-widgets/ios/Widgets/WidgetLiveActivity.swift).
 * ActivityKit matches activities by the attributes type's bare name, so this drives the same CommandActivity
 * layout the app defines in src/widgets/command-activity.tsx, with the props it expects as JSON.
 */
struct LiveActivityAttributes: ActivityAttributes {
  var url: String?
  struct ContentState: Codable, Hashable {
    var name: String
    var props: String?
  }
}

/** The command Live Activity (src/widgets/activity.ts), driven from Swift for Shortcuts and controls. */
final class CommandActivity {
  private static let name = "CommandActivity"
  private let activity: Activity<LiveActivityAttributes>
  private var props: [String: Any]

  /** nil when activities are off, or when this process can't start one (a widget extension). */
  init?(car: String, label: String, symbol: String) {
    props = ["car": car, "label": label, "symbol": symbol, "stage": "cloud", "stageAt": Self.now()]
    guard ActivityAuthorizationInfo().areActivitiesEnabled, let json = Self.encode(props),
      let activity = try? Activity.request(attributes: LiveActivityAttributes(), content: .init(state: .init(name: Self.name, props: json), staleDate: nil))
    else { return nil }
    self.activity = activity
  }

  func update(stage: String) async {
    set(stage: stage, message: nil)
    guard let json = Self.encode(props) else { return }
    await activity.update(.init(state: .init(name: Self.name, props: json), staleDate: nil))
  }

  /** Keeps it live, counting down a timed command (a remote start); iOS marks it stale when the time is up. */
  func hold(minutes: Int, timer: (running: String, ended: String)) async {
    let now = Self.now()
    let endsAt = now + Double(minutes) * 60_000
    props["timer"] = ["startedAt": now, "endsAt": endsAt, "running": timer.running, "ended": timer.ended]
    set(stage: "done", message: nil)
    guard let json = Self.encode(props) else { return }
    await activity.update(.init(state: .init(name: Self.name, props: json), staleDate: Date(timeIntervalSince1970: endsAt / 1000)))
  }

  func end(stage: String, message: String? = nil) async {
    set(stage: stage, message: message)
    guard let json = Self.encode(props) else { return }
    await activity.end(.init(state: .init(name: Self.name, props: json), staleDate: nil), dismissalPolicy: .default)
  }

  /** `stageAt` restarts when the stage changes, so the activity can fill that step over time. */
  private func set(stage: String, message: String?) {
    if props["stage"] as? String != stage { props["stageAt"] = Self.now() }
    props["stage"] = stage
    if let message { props["message"] = message } else { props.removeValue(forKey: "message") }
  }
  private static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }
  private static func encode(_ props: [String: Any]) -> String? {
    guard let data = try? JSONSerialization.data(withJSONObject: props) else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

enum CarCommandRunner {
  /**
   * The one path for every command sent outside the app (Shortcuts, Control Center, widget buttons):
   * shows the same Live Activity the app does, runs the command, records a new lock state, and
   * optionally notifies. Throws what `run` throws, after reporting it.
   */
  static func perform(_ requested: CarCommand, on picked: MottokarCarEntity?, notify: Bool, locks: Bool? = nil) async throws -> String {
    let car = picked ?? MottokarCarEntity.defaultCar()
    let command = car.flatMap { CarClients.brand(for: $0) }?.fit(requested) ?? requested
    let activity = CommandActivity(car: car?.name ?? "Car", label: command.label, symbol: command.symbol)
    do {
      let message = try await run(command, on: car, activity: activity)
      let confirmed = message.hasPrefix(command.done)
      // Controls and widgets show the new state now, not after the app next syncs.
      if let locks, confirmed, let id = car?.id { MottokarCarEntity.setLocked(locks, carId: id) }
      if let activity {
        if confirmed, let timer = command.timer, let minutes = command.minutes { await activity.hold(minutes: minutes, timer: timer) }
        else { await activity.end(stage: confirmed ? "done" : "queued") }
      }
      if notify { await CarCommandRunner.notify(command.done, message) }
      return message
    } catch {
      let reason = (error as? CarCommandError).map { String(localized: $0.localizedStringResource) } ?? error.localizedDescription
      await activity?.end(stage: "failed", message: reason)
      if notify { await CarCommandRunner.notify("Couldn’t reach your car", reason) }
      throw error
    }
  }

  static func run(_ command: CarCommand, on picked: MottokarCarEntity?, activity: CommandActivity? = nil) async throws -> String {
    guard let car = picked ?? MottokarCarEntity.defaultCar() else { throw CarCommandError.noCar }
    var client = try CarClients.client(for: car)
    let outcome = try await client.send(command, to: car) { await activity?.update(stage: "car") }
    switch outcome {
    case .confirmed:
      return "\(command.done). \(car.name)"
    case .unanswered(let waited):
      // The car's state can still confirm it; if the client already waited, one look is enough.
      if let confirmed = command.confirmedBy {
        for _ in 0..<(waited ? 1 : 3) {
          if !waited { try? await Task.sleep(nanoseconds: 5_000_000_000) }
          if let status = try? await client.status(vin: car.vin), confirmed(status) {
            return "\(command.done). \(car.name)"
          }
        }
      }
      return "Sent to \(car.name)"
    }
  }

  static func notify(_ title: String, _ body: String) async {
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.threadIdentifier = "car-commands"
    try? await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
  }
}
