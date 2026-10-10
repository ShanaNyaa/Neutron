import WidgetKit
import SwiftUI
import AppIntents
internal import ExpoWidgets

// AppIntent
struct CarWidgetConfigurationAppIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a car"
  static var description: LocalizedStringResource = "Pick which of your cars this widget shows."

  @Parameter(title: "Car", optionsProvider: CarWidgetCarOptionsProvider())
  var car: String?

  func perform() async throws -> some IntentResult {
    return .result()
  }
}

struct CarWidgetCarOptionsProvider: DynamicOptionsProvider {
  func results() async throws -> IntentItemCollection<String> {
    let options = widgetConfigurationOptions(
      name: "CarWidget",
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

struct CarWidgetTimelineEntry: TimelineEntry {
  let date: Date
  public let name: String
  public let props: [String: Any]?
  public let entryIndex: Int?
  let configuration: CarWidgetConfigurationAppIntent
}

struct CarWidgetTimelineProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CarWidgetTimelineEntry {
    CarWidgetTimelineEntry(date: Date(), name: "CarWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarWidget"), entryIndex: nil, configuration: CarWidgetConfigurationAppIntent())
  }

  func snapshot(for configuration: CarWidgetConfigurationAppIntent, in context: Context) async -> CarWidgetTimelineEntry {
    let entries = parseTimeline(configuration: configuration)
    return entries.first ?? CarWidgetTimelineEntry(date: Date(), name: "CarWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarWidget"), entryIndex: nil, configuration: configuration)
  }

  func timeline(for configuration: CarWidgetConfigurationAppIntent, in context: Context) async -> Timeline<CarWidgetTimelineEntry> {
    let entries = self.parseTimeline(configuration: configuration)
    let timeline = Timeline<CarWidgetTimelineEntry>(entries: entries, policy: .atEnd)
    return timeline
  }
  
  func parseTimeline(configuration: CarWidgetConfigurationAppIntent) -> [CarWidgetTimelineEntry] {
    guard let timeline = WidgetsStorage.getArray(forKey: "__expo_widgets_CarWidget_timeline") else {
      return [CarWidgetTimelineEntry(date: Date(), name: "CarWidget", props: WidgetsLayoutRegistry.initialProps(for: "CarWidget"), entryIndex: nil, configuration: configuration)]
    }
    let entries: [CarWidgetTimelineEntry?] = timeline.enumerated().map { index, entry in
      guard let entry = entry as? [String: Any], let timestamp = entry["timestamp"] as? Int, let props = entry["props"] as? [String: Any] else {
        return nil
      }
      return CarWidgetTimelineEntry(
        date: Date(timeIntervalSince1970: Double(timestamp) / 1000),
        name: "CarWidget",
        props: props,
        entryIndex: index,
        configuration: configuration
      )
    }

    return entries.compactMap(\.self)
  }
}

struct CarWidgetEntryView: View {
  @Environment(\.self) var environment
  var entry: CarWidgetTimelineProvider.Entry

  init(entry: CarWidgetTimelineProvider.Entry) {
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
struct CarWidget: Widget {
  let name: String = "CarWidget"

  var body: some WidgetConfiguration {
    return AppIntentConfiguration(kind: name, intent: CarWidgetConfigurationAppIntent.self, provider: CarWidgetTimelineProvider()) { entry in
      CarWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Car")
    .description("Range, fuel and quick controls.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular])
  }
}