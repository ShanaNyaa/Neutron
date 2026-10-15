// Copied into the app and widget extension by plugins/with-car-intents.js.
// Proton's CarClient. Mirrors src/providers/proton (api.ts, index.ts, mqtt.ts); keep them in step.

import CryptoKit
import Foundation
import Network
import Security

// MARK: - Command results over MQTT (mirrors src/providers/proton/mqtt.ts)

/** What Proton pushes about a command: ISSUED_SUCCESS (it reached the car), then the car's answer. */
enum ProtonCommandEvent {
  case delivered
  case result(ok: Bool, code: String?, message: String?)
}

/**
 * Proton pushes each command's outcome over MQTT; the HTTP control call only says it was queued.
 * A minimal MQTT 3.1.1 client: connect, subscribe, then stream the messages whose taskId is the
 * command's requestId. The broker allows a client id once, so while this is open the app's own
 * connection is kicked (the app reconnects when it next needs one).
 *
 * TLS: like the app, pins the broker's leaf certificate (EMQX's default, CN=Server) byte for byte.
 * No PINGREQ: a watch lives well under the 60 s keepalive.
 */
final class ProtonResultWatch: @unchecked Sendable {
  private static let brokers: [String: (host: String, port: UInt16)] = [
    "prod": ("prodinfomq-atlas.acotech.my", 55883),
    "uat": ("uatinfomq-atlas.acotech.my", 61883),
    "qa": ("qainfomq-atlas.acotech.my", 45883),
  ]
  // Proton Link's MQTT credentials (username = app name, password = the app's mqPassword).
  private static let username = "Proton Link"
  private static let passwords: [String: String] = [
    "prod": "Y7ZlUtuG)YDiNMF_BzjpnpCb[VtH#Tf[",
    "uat": #"8u8yK"bc,].a3l'>w?e;@_A%.vKWh}?6"#,
    "qa": #"8u8yK"bc,].a3l'>w?e;@_A%.vKWh}?6"#,
  ]
  // src/providers/proton/mqtt-server.pem, as DER.
  private static let pinnedCert = Data(base64Encoded: "MIIDEzCCAfugAwIBAgIBAjANBgkqhkiG9w0BAQsFADA/MQswCQYDVQQGEwJDTjERMA8GA1UECAwIaGFuZ3pob3UxDDAKBgNVBAoMA0VNUTEPMA0GA1UEAwwGUm9vdENBMB4XDTIwMDUwODA4MDcwNVoXDTMwMDUwNjA4MDcwNVowPzELMAkGA1UEBhMCQ04xETAPBgNVBAgMCGhhbmd6aG91MQwwCgYDVQQKDANFTVExDzANBgNVBAMMBlNlcnZlcjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALNeWT3pE+QFfiRJzKmnAMUrWo3K2j/Tm3+Xnl6WLz67/0rcYrJbbKvS3uyRP/stXyXEKw9CepyQ1ViBVFkWAoy8qQEOWFDsZc/5UzhXUnb6LXr3qTkFEjNmhj+7uzv/lbBxlUG1NlYzSeOB6/RT8zH/lhOeKhLnWYPXdXKsa1FL6ij4X8DeDO1kY7fvAGmBn/THh1uTpDizM4YmeI+74dmayA5xXvARte5h4Vu5SIze7iC057N+vymToMk2Jgk+ZZFpyXrnq+yo6RaD3ANclrc4FbeUQZ5a5s5Sxgs9a0Y3WMG+7c5VnVXcbjBRz/aq2NtOnQQjikKKQA8GF080BQkCAwEAAaMaMBgwCQYDVR0TBAIwADALBgNVHQ8EBAMCBeAwDQYJKoZIhvcNAQELBQADggEBAJefnMZpaRDHQSNUIEL3iwGXE9c6PmIsQVE2ustr+CakBp3TZ4l0enLtiGMfEVFju69cO4oyokWv+hl5eCMkHBf14Kv51vj448jowYnF1zmzn7SEzm5UzlsasqjtAprnLyof69WtLU1j5rYWBuFX86yOTwRAFNjm9fvhAcrEONBsQtqipBWkMROpiUYMkRqbKcQMdwxov+lHBYKq9zbWRoqLROAn54SRqgQk6c15JdEfgOOjShbsOkIHUhqcwRkQic7n1zwHVGVDgNIZVgmJ2IdIWBlPEC7oLrRrBD/X1iEEXtKab6p5o22nKB5mN+iQaE+Oe2cpGKZJiJRdM+IqDDQ=")

  private let queue = DispatchQueue(label: "com.shananyaa.neutron.mqtt")
  private let connection: NWConnection
  private let deviceId: String
  private let password: String
  private var buffer: [UInt8] = []
  private var ready: CheckedContinuation<Bool, Never>?
  // By task id: a result can arrive before anyone asks for it.
  private var pending: [String: [ProtonCommandEvent]] = [:]
  private var listeners: [String: AsyncStream<ProtonCommandEvent>.Continuation] = [:]

  /** Resolves once subscribed, so a fast reply isn't missed; nil when the broker can't be reached in 8 s. */
  static func open(env: String, deviceId: String) async -> ProtonResultWatch? {
    guard !deviceId.isEmpty else { return nil }
    let watch = ProtonResultWatch(env: env, deviceId: deviceId)
    return await watch.start() ? watch : nil
  }

  private init(env: String, deviceId: String) {
    let broker = Self.brokers[env] ?? Self.brokers["prod"]!
    self.deviceId = deviceId
    password = Self.passwords[env] ?? Self.passwords["prod"]!
    let tls = NWProtocolTLS.Options()
    let queue = queue
    sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, trust, complete in
      let chain = SecTrustCopyCertificateChain(sec_trust_copy_ref(trust).takeRetainedValue()) as? [SecCertificate]
      let leaf = chain?.first.map { SecCertificateCopyData($0) as Data }
      complete(leaf != nil && leaf == Self.pinnedCert)
    }, queue)
    connection = NWConnection(
      host: NWEndpoint.Host(broker.host), port: NWEndpoint.Port(rawValue: broker.port)!, using: NWParameters(tls: tls))
  }

  /** Every event for this command, ending at its result, after `timeout` seconds, or if the connection drops. */
  func events(for taskId: String, timeout: TimeInterval) -> AsyncStream<ProtonCommandEvent> {
    AsyncStream { continuation in
      queue.async { [self] in
        for event in self.pending.removeValue(forKey: taskId) ?? [] {
          continuation.yield(event)
          if case .result = event { return continuation.finish() }
        }
        self.listeners[taskId] = continuation
        continuation.onTermination = { [weak self] _ in self?.queue.async { self?.listeners[taskId] = nil } }
        self.queue.asyncAfter(deadline: .now() + timeout) { continuation.finish() }
      }
    }
  }

  func close() {
    queue.async {
      self.connection.send(content: Data([0xE0, 0x00]), completion: .contentProcessed { [connection = self.connection] _ in connection.cancel() })
    }
  }

  // MARK: Connection

  private func start() async -> Bool {
    await withCheckedContinuation { continuation in
      queue.async { [self] in
        self.ready = continuation
        self.connection.stateUpdateHandler = { [weak self] state in
          guard let self else { return }
          switch state {
          case .ready:
            self.send(Self.packet(0x10, Self.string("MQTT") + [4, 0xC2, 0, 60] + Self.string(self.deviceId) + Self.string(Self.username) + Self.string(self.password)))
            self.receive()
          // .waiting: no route to the broker right now; don't sit out the timeout.
          case .waiting, .failed, .cancelled:
            self.settle(false)
            self.listeners.values.forEach { $0.finish() }
          default: break
          }
        }
        self.connection.start(queue: self.queue)
        self.queue.asyncAfter(deadline: .now() + 8) { self.settle(false) }
      }
    }
  }

  private func settle(_ ok: Bool) {
    guard let ready else { return }
    self.ready = nil
    if !ok { connection.cancel() }
    ready.resume(returning: ok)
  }

  private func send(_ bytes: [UInt8]) {
    connection.send(content: Data(bytes), completion: .idempotent)
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, done, error in
      guard let self else { return }
      if let data { self.buffer.append(contentsOf: data); self.parse() }
      if done || error != nil { return self.connection.cancel() }
      self.receive()
    }
  }

  // MARK: Packets

  private func parse() {
    while buffer.count >= 2 {
      // Remaining length: up to 4 bytes, 7 bits each.
      var length = 0, shift = 0, at = 1
      while true {
        guard at < buffer.count else { return }
        let byte = Int(buffer[at])
        length |= (byte & 0x7F) << shift
        at += 1
        if byte & 0x80 == 0 { break }
        shift += 7
        if at > 4 { return connection.cancel() }
      }
      guard buffer.count >= at + length else { return }
      let header = buffer[0]
      let body = Array(buffer[at..<(at + length)])
      buffer.removeFirst(at + length)
      handle(type: header >> 4, flags: header & 0x0F, body: body)
    }
  }

  private func handle(type: UInt8, flags: UInt8, body: [UInt8]) {
    switch type {
    case 2:  // CONNACK
      guard body.count >= 2, body[1] == 0 else { return settle(false) }
      let topics = ["mobile/\(deviceId)/message", "mobile/\(deviceId)/notify"]
      send(Self.packet(0x82, [0, 1] + topics.flatMap { Self.string($0) + [1] }))
    case 9:  // SUBACK; 0x80 is a refused topic
      settle(body.dropFirst(2).contains { $0 != 0x80 })
    case 3:  // PUBLISH
      guard body.count >= 2 else { return }
      var at = 2 + (Int(body[0]) << 8 | Int(body[1]))
      if (flags >> 1) & 3 > 0 {
        guard body.count >= at + 2 else { return }
        send([0x40, 0x02, body[at], body[at + 1]])  // PUBACK
        at += 2
      }
      guard body.count >= at else { return }
      deliver(Data(body[at...]))
    default: break
    }
  }

  /** A push is {messageCategory, content}; for commands, content (an object or JSON string) is {taskId, serviceResult, code, body, ...}. */
  private func deliver(_ payload: Data) {
    guard let message = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else { return }
    if let category = message["messageCategory"] as? String, category != "VEHICLE_CONTROL" { return }
    let content = message["content"] as? [String: Any]
      ?? (message["content"] as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    guard let content, let taskId = Self.text(content["taskId"]) else { return }
    let event: ProtonCommandEvent
    switch content["serviceResult"] as? String {
    case "ISSUED_SUCCESS": event = .delivered
    case "EXECUTION_SUCCESS": event = .result(ok: true, code: Self.text(content["code"]), message: nil)
    case "EXECUTION_FAIL":
      event = .result(ok: false, code: Self.text(content["code"]), message: Self.text(content["body"]) ?? Self.text(content["message"]))
    default: return
    }
    if let listener = listeners[taskId] {
      listener.yield(event)
      if case .result = event { listener.finish() }
    } else {
      pending[taskId, default: []].append(event)
    }
  }

  private static func packet(_ header: UInt8, _ body: [UInt8]) -> [UInt8] {
    var out = [header]
    var n = body.count
    repeat {
      var byte = UInt8(n % 128)
      n /= 128
      if n > 0 { byte |= 0x80 }
      out.append(byte)
    } while n > 0
    return out + body
  }

  private static func string(_ s: String) -> [UInt8] {
    let bytes = Array(s.utf8)
    return [UInt8(bytes.count >> 8), UInt8(bytes.count & 0xFF)] + bytes
  }

  private static func text(_ v: Any?) -> String? {
    if let s = v as? String { return s.isEmpty ? nil : s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
  }
}

// MARK: - Proton (mirrors src/providers/proton/api.ts and index.ts)

/** One Proton vehicleControl request. */
struct ProtonControl {
  let serviceKey: String
  var duration: Int? = nil
  var parameters: [[String: String]]? = nil

  /** Mirrors CONTROLS in src/providers/proton/index.ts. */
  init?(_ command: CarCommand) {
    switch command.id {
    case "lock": serviceKey = "RDL-OFF"
    case "unlock": serviceKey = "RDU-ON"
    case "climate_on":
      serviceKey = "RCE-ON"
      parameters = [["key": "rce.temp", "stringVal": String(command.temp ?? 22)]]
    case "climate_off": serviceKey = "RCE-OFF"
    case "horn_lights": serviceKey = "RHL-HornAndLight"
    case "lights": serviceKey = "RHL-LIGHT"
    case "windows_close": serviceKey = "RWS-OFF"
    case "windows_open": serviceKey = "RWS-ON"
    case "sunroof_close": serviceKey = "RWS-SunroofOFF"
    case "trunk_open": serviceKey = "RDU-TargetON"
    case "engine_start":
      serviceKey = "RES-Engine-ON"
      duration = command.minutes ?? 10
    case "engine_stop": serviceKey = "RES-Engine-OFF"
    default: return nil
    }
  }
}

extension ProtonCarClient: CarClient {
  static let provider = "proton"

  static func fit(_ command: CarCommand) -> CarCommand {
    guard command.id == "engine_start", let minutes = command.minutes else { return command }
    // Proton Link offers 3, 5, 8 or 10 minutes (the engine_start options in index.ts).
    let allowed = [3, 5, 8, 10]
    return .startEngine(minutes: allowed.min { abs($0 - minutes) < abs($1 - minutes) } ?? 10)
  }

  /** Mirrors the app's Proton sendCommand: the car's answer comes over MQTT. */
  mutating func send(_ command: CarCommand, to car: NeutronCarEntity, delivered: () async -> Void) async throws -> CommandOutcome {
    guard let request = ProtonControl(command) else { throw CarCommandError.unsupported }
    if car.pinRequired { try await checkPin(vin: car.vin) }
    // Listen before sending: a fast car can answer before the HTTP call returns.
    // A binding can lapse, leaving MQTT connected but silent, so renew it first.
    await bindPushDevice()
    let watch = await ProtonResultWatch.open(env: env, deviceId: pushDeviceId)
    defer { watch?.close() }
    let requestId = try await control(vin: car.vin, request)
    guard let watch, let requestId else {
      await delivered()
      return .unanswered(waited: false)
    }
    // 40 s is Proton Link's own command timeout.
    for await event in watch.events(for: requestId, timeout: 40) {
      switch event {
      case .delivered:
        await delivered()
      case let .result(ok, code, message):
        if ok { return .confirmed }
        throw CarCommandError.brand(Self.refusal(code: code, message: message))
      }
    }
    return .unanswered(waited: true)
  }

  /** Mirrors carRefusal in src/providers/proton/index.ts, keyed by EXECUTION_FAIL code. */
  private static func refusal(code: String?, message: String?) -> String {
    switch code {
    // The car allows only a few remote starts until it has been driven.
    case "2048": "Remote start limit reached. Drive the car once, then try again."
    default: message ?? "The car couldn’t do that"
    }
  }
}

struct ProtonCarClient {
  private let secretsKey: String
  private var secrets: [String: Any]
  private var session: [String: Any]

  private static let hosts: [String: (legacy: String, atlas: String)] = [
    "prod": ("https://app.acotech.my:8443/", "https://app-atlas.acotech.my:8443/"),
    "uat": ("https://appuat.acotech.my:60033/", "https://uatapp-atlas.acotech.my:60012/"),
    "qa": ("https://app.acotech.my:50011/", "https://qaapp-atlas.acotech.my:50012/"),
  ]
  private static let tokenExpired = 40006

  init(connectionId: String) throws {
    secretsKey = "connections.\(connectionId).secrets"
    guard let raw = SharedKeychain.get(secretsKey),
          let json = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
          let session = json["session"] as? [String: Any],
          session["accessToken"] is String else { throw CarCommandError.signedOut }
    secrets = json
    self.session = session
  }

  fileprivate var env: String { session["env"] as? String ?? "prod" }
  /** Server-issued; Proton routes MQTT results only to it (src/providers/proton/push-device.ts). */
  fileprivate var pushDeviceId: String { session["pushDeviceId"] as? String ?? session["deviceId"] as? String ?? "" }
  private var userId: String { session["userId"] as? String ?? "" }
  private var hosts: (legacy: String, atlas: String) { Self.hosts[env] ?? Self.hosts["prod"]! }

  // MARK: Calls

  fileprivate mutating func checkPin(vin: String) async throws {
    // The app stores the PIN readable only while the iPhone is unlocked (secure-kv whenUnlocked).
    guard let pin = SharedKeychain.get("proton.pin.\(userId)") else {
      // The marker is readable while locked; if it's there, the PIN is too once unlocked.
      throw SharedKeychain.get("proton.pinSaved.\(userId)") != nil ? CarCommandError.pinLocked : CarCommandError.needsPin
    }
    // Proton Link sends md5(md5(pin) + userId) with type VEHICLE_CONTROL.
    let pinCode = md5(md5(pin) + userId)
    do {
      _ = try await atlas("basic/vehicle/checkPinCode", body: ["vin": vin, "pinCode": pinCode, "type": "VEHICLE_CONTROL"])
    } catch CarCommandError.brand {
      throw CarCommandError.wrongPin
    }
  }

  /** push-device.ts bindPushDevice. Never throws. */
  fileprivate mutating func bindPushDevice() async {
    guard let pushId = session["pushDeviceId"] as? String else { return }
    let uniquelyId = String((session["deviceId"] as? String ?? "").prefix(16))
    _ = try? await atlas("information/mobileSync/integrated/replenish", body: ["deviceId": pushId, "uniquelyId": uniquelyId])
  }

  /** Returns the requestId, which the car's MQTT result carries as taskId. */
  fileprivate mutating func control(vin: String, _ c: ProtonControl) async throws -> String? {
    let body: [String: Any] = [
      "vin": vin, "serviceKey": c.serviceKey,
      "scheduledTime": NSNull(), "endTime": NSNull(), "timerData": NSNull(),
      "duration": c.duration.map { $0 as Any } ?? NSNull(),
      "parameters": c.parameters.map { $0 as Any } ?? NSNull(),
    ]
    let data = try await atlas("iot/function/vehicleControl", body: body) as? [String: Any]
    return data?["requestId"] as? String
  }

  mutating func status(vin: String) async throws -> CarStatus {
    let data = try await atlas("iot/function/getVehicleStatus", body: ["vin": vin]) as? [String: Any] ?? [:]
    // mappers.ts lockState: locked when each door lock is 2, 3 or absent.
    let doorLocked: (Any?) -> Bool = { v in
      guard let n = Self.int(v) else { return true }
      return n == 2 || n == 3
    }
    let locks = ["doorLockStatusLeftFront", "doorLockStatusLeftRear", "doorLockStatusRightFront", "doorLockStatusRightRear"]
    let locked = locks.allSatisfy { doorLocked(data[$0]) }
    let engine = Self.int(data["engineStatus"]).map { $0 == 0 }
    return CarStatus(locked: locked, engineOn: engine)
  }

  // MARK: Transport

  /** One token refresh on expiry, like ProtonApi.withRefresh. */
  private mutating func atlas(_ path: String, body: [String: Any]) async throws -> Any? {
    do {
      return try await send(hosts.atlas + path, body: body, headers: atlasHeaders())
    } catch CarCommandError.signedOut {
      try await refresh()
      return try await send(hosts.atlas + path, body: body, headers: atlasHeaders())
    }
  }

  private mutating func refresh() async throws {
    let body: [String: Any] = [
      "userId": userId,
      "refreshToken": session["refreshToken"] as? String ?? "",
      "clientType": "phone",
      "deviceId": session["deviceId"] as? String ?? "",
    ]
    guard let data = try? await send(hosts.legacy + "app/v1/member/tokenRefresh", body: body, headers: legacyHeaders()) as? [String: Any],
          let token = data["accessToken"] as? String else { throw CarCommandError.signedOut }
    session["accessToken"] = token
    secrets["session"] = session
    // Save it back so the app uses the new token too.
    if let json = try? JSONSerialization.data(withJSONObject: secrets), let text = String(data: json, encoding: .utf8) {
      SharedKeychain.set(secretsKey, text)
    }
  }

  private func send(_ url: String, body: [String: Any], headers: [String: String]) async throws -> Any? {
    var req = URLRequest(url: URL(string: url)!, timeoutInterval: 20)
    req.httpMethod = "POST"
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
    let (data, response) = try await URLSession.shared.data(for: req)
    if (response as? HTTPURLResponse)?.statusCode == 401 { throw CarCommandError.signedOut }
    guard let env = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw CarCommandError.brand("Proton didn't answer. Try again in a moment.")
    }
    let code = Self.int(env["code"])
    if code == 200 { return env["data"] }
    if code == Self.tokenExpired { throw CarCommandError.signedOut }
    throw CarCommandError.brand(env["msg"] as? String ?? "Proton error \(code ?? 0)")
  }

  // Same identity the app presents (api.ts atlasHeaders / legacyHeaders).
  private func atlasHeaders() -> [String: String] {
    [
      "ACCEPT-LANGUAGE": "en",
      "VERSION-NAME": "2.1.0",
      "VERSION-CODE": "210",
      "X-EQUIPMENT-TYPE": "Proton_Link",
      "X-EQUIPMENT-BRAND": "google",
      "X-EQUIPMENT-MODEL": "Pixel 7",
      "X-EQUIPMENT-OS-VERSION": "14",
      "X-AGENT-VERSION": "34",
      "CLIENT-ID": "android",
      "TENANT-ID": "acotech",
      "APP-NAME": "Proton Link",
      "REQUEST-ID": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased(),
      "Authorization": "Bearer \(session["accessToken"] as? String ?? "")",
    ]
  }

  private func legacyHeaders() -> [String: String] {
    [
      "X-AGENT-TYPE": "android",
      "Accept-Language": "en",
      "Connection": "close",
      "APP-NAME": "Proton Link",
      "Version-Name": "2.1.0",
      "Version-Code": "210",
      "X-APP-ID": "protonlink_01",
      "X-EQUIPMENT-TYPE": "proton link",
      "X-AGENT-VERSION": "34",
      "AUTHORIZATION": "",
    ]
  }

  private static func int(_ v: Any?) -> Int? {
    if let n = v as? Int { return n }
    if let n = v as? NSNumber { return n.intValue }
    if let s = v as? String { return Int(s) }
    return nil
  }

  private func md5(_ s: String) -> String {
    Insecure.MD5.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
