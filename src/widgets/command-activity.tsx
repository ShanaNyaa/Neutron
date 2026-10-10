import { Capsule, HStack, Image, ProgressView, RoundedRectangle, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  background,
  clipShape,
  contentTransition,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  progressViewStyle,
  tint,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

export type CommandActivityProps = {
  car: string;
  label: string;
  /** SF Symbol for the command (widgets/symbols.ts) */
  symbol: string;
  stage: "cloud" | "car" | "done" | "queued" | "failed";
  /** Failure reason, or a result like "Locked" */
  message?: string;
  /** When the current stage began (ms); set by widgets/activity.ts. */
  stageAt?: number;
  /** A command that keeps running (e.g. a remote start), worded by its CommandDefinition.timer */
  timer?: { startedAt?: number; endsAt: number; running: string; ended: string };
};

const CommandActivity = (props: CommandActivityProps, environment: LiveActivityEnvironment) => {
  "widget";
  const fg = "#f5f6f8";
  const muted = "#9aa3b2";
  const dim = "#6b7280";
  const faint = "#ffffff1f";
  const half = "#f5f6f866";
  const bad = "#f87171";
  const badSoft = "#f8717129";

  const isFailed = props.stage === "failed";
  // A timed command is held live until its end time, then goes stale: it has ended.
  const timer = props.timer;
  const isEnded = !!timer && (environment.isStale || Date.now() >= timer.endsAt);
  const isCounting = !!timer && props.stage === "done" && !isEnded;
  const isTimed = isCounting || isEnded;
  const status = isFailed
    ? (props.message ?? "The car couldn’t do that")
    : isEnded
      ? timer.ended
      : isCounting
        ? timer.running
        : props.stage === "done"
          ? (props.message ?? "Done")
          : props.stage === "queued"
            ? "Sent to your car"
            : props.stage === "car"
              ? "Waiting for the car…"
              : "Sending to the cloud…";
  const badge = isFailed
    ? "xmark"
    : isEnded
      ? "stop.fill"
      : props.stage === "done" || props.stage === "queued"
        ? "checkmark"
        : props.stage === "car"
          ? "car.fill"
          : "icloud.and.arrow.up.fill";
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endsAtText = timer ? clock(timer.endsAt) : "";

  // The command's own symbol on a tile, so it reads at a glance which command this is.
  const tile = (size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <RoundedRectangle cornerRadius={size * 0.28} modifiers={[foregroundStyle(isFailed ? badSoft : faint)]} />
      <Image systemName={props.symbol as never} size={size * 0.45} color={isFailed ? bad : fg} />
    </ZStack>
  );

  // Every stage has the same three lines, so the activity keeps one height.
  const text = (labelSize: number) => (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(muted), lineLimit(1)]}>{props.car}</Text>
      <Text modifiers={[font({ size: labelSize, weight: "semibold" }), foregroundStyle(fg), lineLimit(1)]}>{props.label}</Text>
      <Text
        modifiers={[
          font({ size: 13 }),
          foregroundStyle(isFailed ? bad : muted),
          lineLimit(1),
          minimumScaleFactor(0.85),
          truncationMode("tail"),
          contentTransition("interpolate"),
        ]}
      >
        {status}
      </Text>
    </VStack>
  );

  // Right side: the countdown, or a small badge for the stage. Timer text takes all the width
  // it's offered and left-aligns in it, so it's right-aligned in a fixed width.
  const countdown = (size: number, width: number) => (
    <Text
      timerInterval={{ lower: new Date(), upper: new Date(timer!.endsAt) }}
      countsDown
      modifiers={[
        font({ size, weight: "semibold" }),
        monospacedDigit(),
        foregroundStyle(fg),
        multilineTextAlignment("trailing"),
        frame({ width, alignment: "trailing" }),
      ]}
    />
  );
  const stageBadge = (size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size }), background(isFailed ? badSoft : faint), clipShape("circle")]}>
      <Image systemName={badge} size={size * 0.42} color={isFailed ? bad : fg} modifiers={[contentTransition("interpolate")]} />
    </ZStack>
  );
  const trailing = (size: number) => (isCounting ? countdown(size * 0.85, size * 2.6) : stageBadge(size));

  // Bottom: phone → cloud → car while sending; a draining bar while a timed command runs. Both
  // are a 4pt bar over one caption line, so switching between them keeps the height.
  const caption = (label: string, color: string) => (
    <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(color), lineLimit(1)]}>{label}</Text>
  );
  const reached = props.stage === "cloud" ? 1 : props.stage === "car" || props.stage === "queued" ? 2 : 3;
  const isWorking = props.stage === "cloud" || props.stage === "car";
  const stepColor = (i: number) => (isFailed && i === Math.min(reached, 2) ? bad : i < reached ? fg : isWorking && i === reached ? half : faint);
  const stepCaption = (i: number) => (isFailed && i === Math.min(reached, 2) ? bad : i < reached || (isWorking && i === reached) ? fg : dim);
  // Each segment and its caption share a column, so the caption starts where its segment does.
  // The step in progress fills over a typical wait, driven by iOS (a Live Activity can't run its own
  // animation): a few seconds to reach the cloud, up to ~30 s for the car to answer.
  const EXPECTED = { cloud: 4_000, car: 30_000 };
  const step = (i: number) => {
    if (isWorking && i === reached && props.stageAt != null) {
      const from = new Date(props.stageAt);
      const to = new Date(props.stageAt + EXPECTED[props.stage as "cloud" | "car"]);
      return (
        <ZStack modifiers={[frame({ height: 4 }), clipShape("capsule")]}>
          <Capsule modifiers={[frame({ height: 4 }), foregroundStyle(faint)]} />
          <ProgressView
            timerInterval={{ lower: from, upper: to }}
            countsDown={false}
            modifiers={[progressViewStyle("linear"), tint(fg), labelsHidden(), frame({ height: 4 })]}
          />
        </ZStack>
      );
    }
    return <Capsule modifiers={[frame({ height: 4 }), foregroundStyle(stepColor(i)), contentTransition("interpolate")]} />;
  };
  const steps = (
    <HStack spacing={4}>
      {["Phone", "Cloud", "Car"].map((name, i) => (
        <VStack key={name} alignment="leading" spacing={6}>
          {step(i)}
          {caption(name, stepCaption(i))}
        </VStack>
      ))}
    </HStack>
  );
  const countdownBar = (
    <VStack spacing={6}>
      {isCounting ? (
        <ProgressView
          timerInterval={{ lower: new Date(), upper: new Date(timer!.endsAt) }}
          countsDown
          // labelsHidden: the timer ProgressView otherwise draws its own time label under the bar.
          modifiers={[progressViewStyle("linear"), tint(fg), labelsHidden(), frame({ height: 4 })]}
        />
      ) : (
        <Capsule modifiers={[frame({ height: 4 }), foregroundStyle(faint)]} />
      )}
      <HStack>
        {caption(timer?.startedAt ? `Started ${clock(timer.startedAt)}` : "", dim)}
        <Spacer />
        {caption(`${timer?.ended ?? ""} at ${endsAtText}`, isCounting ? fg : muted)}
      </HStack>
    </VStack>
  );
  const footer = isTimed ? countdownBar : steps;

  // CarPlay and the watch Smart Stack show the `.small` family: one row, no footer, so it fits
  // their card without clipping. The label and status share a line to keep it to two lines.
  const bannerSmall = (
    <HStack spacing={10} modifiers={[padding({ horizontal: 12, vertical: 10 }), activityBackgroundTint("#14161a")]}>
      {tile(34)}
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(fg), lineLimit(1)]}>
          {`${props.label} · ${props.car}`}
        </Text>
        <Text
          modifiers={[
            font({ size: 12 }),
            foregroundStyle(isFailed ? bad : muted),
            lineLimit(1),
            minimumScaleFactor(0.85),
            truncationMode("tail"),
            contentTransition("interpolate"),
          ]}
        >
          {isEnded ? `${timer.ended} at ${endsAtText}` : status}
        </Text>
      </VStack>
      <Spacer />
      {trailing(26)}
    </HStack>
  );

  return {
    bannerSmall,
    banner: (
      <VStack alignment="leading" spacing={14} modifiers={[padding({ horizontal: 18, vertical: 16 }), activityBackgroundTint("#14161a")]}>
        <HStack spacing={12}>
          {tile(44)}
          {text(17)}
          <Spacer />
          {trailing(32)}
        </HStack>
        {footer}
      </VStack>
    ),
    compactLeading: <Image systemName={props.symbol as never} size={14} color={isFailed ? bad : fg} />,
    compactTrailing: isCounting ? (
      countdown(14, 44)
    ) : (
      <Image systemName={badge} size={13} color={isFailed ? bad : fg} modifiers={[contentTransition("interpolate")]} />
    ),
    minimal: <Image systemName={(isCounting ? "timer" : props.symbol) as never} size={13} color={isFailed ? bad : fg} />,
    expandedLeading: <VStack modifiers={[padding({ leading: 6, top: 6 })]}>{tile(40)}</VStack>,
    expandedCenter: <VStack alignment="leading" modifiers={[padding({ top: 4 })]}>{text(16)}</VStack>,
    expandedTrailing: <VStack modifiers={[padding({ trailing: 6, top: 6 })]}>{trailing(30)}</VStack>,
    expandedBottom: <VStack modifiers={[padding({ horizontal: 6, top: 8, bottom: 4 })]}>{footer}</VStack>,
  };
};

export default createLiveActivity<CommandActivityProps>("CommandActivity", CommandActivity);
