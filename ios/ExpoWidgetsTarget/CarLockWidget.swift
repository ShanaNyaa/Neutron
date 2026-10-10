import WidgetKit
import SwiftUI
import AppIntents
internal import ExpoWidgets

// AppIntent
struct CarLockWidgetConfigurationAppIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a car"
  static var description: LocalizedStringResource = "Pick which of your cars this widget shows."

  @Parameter(title: "Car", optionsProvider: CarLockWidgetCarOptionsProvider())
  var car: String?

  func perform() async throws -> some IntentResult {
    return .result()
  }
}

struct CarLockWidgetCarOptionsProvider: DynamicOptionsProvider {
  func results() async throws -> IntentItemCollection<String> {
    let options = widgetConfigurationOptions(
      name: "CarLockWidget",
      parameter: "car",
      fallback: [
        WidgetConfigurationOption(name: "Default car", value: "main")
      ]
    )

    return IntentItemCollection(sections: [
      IntentItemSection(items: options.map { option in
        IntentItem(
          option.value,
          title: LocalizedStringResource(stringLiteral: option.name),
          subtitle: option.subtitle.map { LocalizedStringResource(stringLiteral: $0) }
        )
      })
    ])
  }

  func defaultResult() async -> String? {
    return "main"
  }
}

struct CarLockWidgetTimelineEntry: TimelineEntry {
  let date: Date
  public let name: String
  public let props: [String: Any]?
  public let entryIndex: Int?
  let configuration: CarLockWidgetConfigurationAppIntent
}

struct CarLockWidgetTimelineProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CarLockWidgetTimelineEntry {
    CarLockWidgetTimelineEntry(date: Date(), name: "CarLockWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarLockWidget"), entryIndex: nil, configuration: CarLockWidgetConfigurationAppIntent())
  }

  func snapshot(for configuration: CarLockWidgetConfigurationAppIntent, in context: Context) async -> CarLockWidgetTimelineEntry {
    let entries = parseTimeline(configuration: configuration)
    return entries.first ?? CarLockWidgetTimelineEntry(date: Date(), name: "CarLockWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarLockWidget"), entryIndex: nil, configuration: configuration)
  }

  func timeline(for configuration: CarLockWidgetConfigurationAppIntent, in context: Context) async -> Timeline<CarLockWidgetTimelineEntry> {
    let entries = self.parseTimeline(configuration: configuration)
    let timeline = Timeline<CarLockWidgetTimelineEntry>(entries: entries, policy: .atEnd)
    return timeline
  }
  
  func parseTimeline(configuration: CarLockWidgetConfigurationAppIntent) -> [CarLockWidgetTimelineEntry] {
    guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_CarLockWidget_timeline") else {
      return [CarLockWidgetTimelineEntry(date: Date(), name: "CarLockWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarLockWidget"), entryIndex: nil, configuration: configuration)]
    }
    let entries: [CarLockWidgetTimelineEntry?] = timeline.enumerated().map { index, entry in
      guard let entry = entry as? [String: Any], let timestamp = entry["timestamp"] as? Int, let props = entry["props"] as? [String: Any] else {
        return nil
      }
      return CarLockWidgetTimelineEntry(
        date: Date(timeIntervalSince1970: Double(timestamp) / 1000),
        name: "CarLockWidget",
        props: props,
        entryIndex: index,
        configuration: configuration
      )
    }

    return entries.compactMap(\.self)
  }
}

struct CarLockWidgetEntryView: View {
  @Environment(\.self) var environment
  var entry: CarLockWidgetTimelineProvider.Entry

  init(entry: CarLockWidgetTimelineProvider.Entry) {
    self.entry = entry
  }

  private var widgetEnvironment: [String: Any] {
    var env: [String: Any] = getWidgetEnvironment(environment: environment)
    env["timestamp"] = Int(entry.date.timeIntervalSince1970 * 1000)
    env["configuration"] = [
        "car": entry.configuration.car
    ]
    return env
  }

  private var widgetEnvironmentString: String? {
    guard let data = try? JSONSerialization.data(withJSONObject: widgetEnvironment),
          let jsonString = String(data: data, encoding: .utf8) else {
        return nil
    }
    return jsonString
  }

  public var body: some View {
    if let layout = WidgetsLayoutRegistry.layout(for: entry.name) {
      let node = evaluateLayout(layout: layout, props: entry.props, environment: widgetEnvironment)
      WidgetsDynamicView(name: entry.name, kind: .widget, node: node, entryIndex: entry.entryIndex, environmentString: widgetEnvironmentString)
    } else {
      WidgetsDynamicView(name: entry.name, kind: .widget, node: createRedBox(message: "No layout found for \(WidgetsStorage.appGroupIdentifier ?? "")::\(entry.name)"), entryIndex: entry.entryIndex, environmentString: widgetEnvironmentString)
    }
  }
}


@available(iOS 17.0, *)
struct CarLockWidget: Widget {
  let name: String = "CarLockWidget"

  var body: some WidgetConfiguration {
    return AppIntentConfiguration(kind: name, intent: CarLockWidgetConfigurationAppIntent.self, provider: CarLockWidgetTimelineProvider()) { entry in
      CarLockWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Lock")
    .description("Whether your car is locked, at a glance.")
    .supportedFamilies([.accessoryCircular])
  }
}