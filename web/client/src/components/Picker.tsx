import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import type { CommandParam } from "../commands.ts";
import type { PickerStyle } from "../prefs.ts";

type Props = { param: CommandParam; value: number; onChange: (v: number) => void };

/** Picks one of a command's options (a temperature, a run time) by scrolling or dragging. */
export function Picker({ style, ...props }: Props & { style: PickerStyle }) {
  if (style === "slider") return <Slider {...props} />;
  if (style === "dial") return <Dial {...props} />;
  return <Wheel {...props} />;
}

/** Arrow keys step through options in every style. */
function useStep({ param, value, onChange }: Props) {
  const i = Math.max(0, param.options.findIndex((o) => o.value === value));
  return (e: KeyboardEvent) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = param.options[Math.min(param.options.length - 1, Math.max(0, i + step))];
    onChange(next.value);
  };
}

/**
 * Scroll-snapping list, picked by wherever it settles. Shared by the wheel (vertical) and the
 * dial (horizontal): `size` is one item's height or width.
 */
function useSnap(props: Props, axis: "y" | "x", size: number) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, props.param.options.findIndex((o) => o.value === props.value));
  const settling = useRef<number | undefined>(undefined);

  // Start on the current value, without animating.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el[axis === "y" ? "scrollTop" : "scrollLeft"] = index * size;
  }, []);

  // A change from the keyboard or a tap scrolls there.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = index * size;
    const now = axis === "y" ? el.scrollTop : el.scrollLeft;
    if (Math.abs(now - target) > 2) el.scrollTo({ [axis === "y" ? "top" : "left"]: target, behavior: "smooth" });
  }, [index, axis, size]);

  const onScroll = () => {
    clearTimeout(settling.current);
    settling.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.round((axis === "y" ? el.scrollTop : el.scrollLeft) / size);
      const opt = props.param.options[Math.min(props.param.options.length - 1, Math.max(0, i))];
      if (opt.value !== props.value) props.onChange(opt.value);
    }, 90);
  };
  return { ref, index, onScroll };
}

const ROW = 44;

function Wheel(props: Props) {
  const { ref, index, onScroll } = useSnap(props, "y", ROW);
  const onKeyDown = useStep(props);
  const { param } = props;
  return (
    <div className="wheel-wrap" style={{ height: ROW * 5 }}>
      <div
        ref={ref}
        className="wheel"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="spinbutton"
        aria-label={param.label}
        aria-valuenow={props.value}
        aria-valuetext={param.options[index]?.label}
      >
        {/* Spacers let the first and last options reach the middle band. */}
        <div style={{ height: ROW * 2, flex: "none" }} aria-hidden />
        {param.options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            tabIndex={-1}
            className={`wheel-item ${i === index ? "on" : ""} ${Math.abs(i - index) === 1 ? "near" : ""}`}
            style={{ height: ROW }}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
        <div style={{ height: ROW * 2, flex: "none" }} aria-hidden />
      </div>
      <div className="wheel-band" style={{ top: ROW * 2, height: ROW }} aria-hidden />
    </div>
  );
}

function Slider(props: Props) {
  const { param, value, onChange } = props;
  const index = Math.max(0, param.options.findIndex((o) => o.value === value));
  const pct = (index / Math.max(1, param.options.length - 1)) * 100;
  return (
    <div className="slider-picker">
      <div className="slider-readout">{param.options[index]?.label}</div>
      <input
        type="range"
        min={0}
        max={param.options.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(param.options[Number(e.target.value)].value)}
        aria-label={param.label}
        aria-valuetext={param.options[index]?.label}
        style={{ ["--fill" as string]: `${pct}%` }}
      />
      <div className="slider-ends muted small">
        <span>{param.options[0].label}</span>
        <span>{param.options.at(-1)!.label}</span>
      </div>
    </div>
  );
}

const TICK = 64;

function Dial(props: Props) {
  const { ref, index, onScroll } = useSnap(props, "x", TICK);
  const onKeyDown = useStep(props);
  const { param } = props;
  return (
    <div className="dial-wrap">
      <div className="dial-readout">{param.options[index]?.label}</div>
      <div
        ref={ref}
        className="dial"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="spinbutton"
        aria-label={param.label}
        aria-valuenow={props.value}
        aria-valuetext={param.options[index]?.label}
        style={{ paddingInline: `calc(50% - ${TICK / 2}px)` }}
      >
        {param.options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            tabIndex={-1}
            className={`dial-item ${i === index ? "on" : ""}`}
            style={{ width: TICK }}
            onClick={() => props.onChange(o.value)}
          >
            <span className="dial-tick" />
            <span className="dial-label">{o.label}</span>
          </button>
        ))}
      </div>
      <div className="dial-pointer" aria-hidden />
    </div>
  );
}
