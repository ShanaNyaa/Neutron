// Copied into the app and widget extension by plugins/with-car-intents.js.
// Every brand that can run commands from outside the app, like src/providers/index.ts.
// A brand the app has but this list lacks gets CarCommandError.unsupported.

extension CarClients {
  static let brands: [any CarClient.Type] = [ProtonCarClient.self]
}
