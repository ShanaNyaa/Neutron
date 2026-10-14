import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 450;
// Moving further than this before the hold completes is a scroll, not a press.
const SLOP_PX = 10;
const EDGE_PX = 90;

type Drag = { id: string; grabX: number; grabY: number; x: number; y: number; avoid: string | null };

/**
 * Press and hold a widget to start arranging, then drag widgets into place, like a phone's
 * home screen. Works with touch and mouse through pointer events.
 *
 * Each widget renders as a slot (measured, never transformed) wrapping an inner element
 * (moved). Hit-testing uses the slots, so the sliding animation never causes a swap back.
 */
export function useArrange(ids: string[], save: (ids: string[]) => void) {
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const slots = useRef(new Map<string, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  const before = useRef(new Map<string, DOMRect>());
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const current = order ?? ids;
  const currentRef = useRef(current);
  currentRef.current = current;

  const inner = (id: string) => slots.current.get(id)?.firstElementChild as HTMLElement | null | undefined;

  /** Puts the dragged widget under the finger, wherever its slot now is. */
  const place = useCallback(() => {
    const d = drag.current;
    const slot = d && slots.current.get(d.id);
    const el = d && inner(d.id);
    if (!d || !slot || !el) return;
    const r = slot.getBoundingClientRect();
    el.style.transform = `translate(${d.x - d.grabX - r.left}px, ${d.y - d.grabY - r.top}px) scale(1.04)`;
  }, []);

  const move = useCallback(
    (x: number, y: number) => {
      const d = drag.current;
      if (!d) return;
      d.x = x;
      d.y = y;
      place();
      // Keep dragging past the edge of the screen by scrolling.
      if (y < EDGE_PX) window.scrollBy(0, -14);
      else if (y > window.innerHeight - EDGE_PX - 64) window.scrollBy(0, 14);

      for (const [id, slot] of slots.current) {
        if (id === d.id) continue;
        const r = slot.getBoundingClientRect();
        const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        if (!inside) {
          if (d.avoid === id) d.avoid = null;
          continue;
        }
        // After a swap the finger can still be over the widget it just passed; wait until it leaves.
        if (d.avoid === id) return;
        const next = currentRef.current.filter((w) => w !== d.id);
        const at = next.indexOf(id) + (currentRef.current.indexOf(d.id) < currentRef.current.indexOf(id) ? 1 : 0);
        next.splice(at, 0, d.id);
        before.current = new Map([...slots.current].map(([k, s]) => [k, s.getBoundingClientRect()]));
        d.avoid = id;
        setOrder(next);
        return;
      }
    },
    [place],
  );

  // After a reorder, slide every other widget from where it was (FLIP), and re-place the dragged one.
  useLayoutEffect(() => {
    if (!before.current.size) return;
    for (const [id, slot] of slots.current) {
      if (id === drag.current?.id) continue;
      const was = before.current.get(id);
      const el = inner(id);
      if (!was || !el) continue;
      const now = slot.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 0.2s ease";
      el.style.transform = "";
    }
    before.current = new Map();
    place();
  }, [order, place]);

  const end = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const el = inner(d.id);
    if (el) {
      el.style.transition = "transform 0.15s ease";
      el.style.transform = "";
    }
    drag.current = null;
    setDragId(null);
    save(currentRef.current);
    setOrder(null);
  }, [save]);

  // Window listeners while dragging, so the drag survives the widget moving in the DOM.
  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    const onUp = () => end();
    // Without this a touch drag scrolls the page instead.
    const noScroll = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
    };
  }, [dragId, move, end]);

  const start = (id: string, x: number, y: number) => {
    const slot = slots.current.get(id);
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    drag.current = { id, grabX: x - r.left, grabY: y - r.top, x, y, avoid: null };
    const el = inner(id);
    if (el) el.style.transition = "none";
    setOrder(currentRef.current);
    setDragId(id);
    place();
  };

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (id: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".slot-remove")) return;
    const { clientX: x, clientY: y } = e;
    if (arranging) {
      e.preventDefault();
      start(id, x, y);
      return;
    }
    cancelPress();
    const timer = window.setTimeout(() => {
      press.current = null;
      setArranging(true);
      navigator.vibrate?.(15);
      // The release that ends this press shouldn't also tap the widget (e.g. cycle tyre units).
      window.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
      start(id, x, y);
    }, HOLD_MS);
    press.current = { timer, x, y };
    const onMove = (ev: PointerEvent) => {
      if (press.current && Math.hypot(ev.clientX - press.current.x, ev.clientY - press.current.y) > SLOP_PX) stop();
    };
    const stop = () => {
      cancelPress();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  useEffect(() => cancelPress, []);

  const slotRef = (id: string) => (el: HTMLElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  };

  return { order: current, arranging, setArranging, dragId, slotRef, onPointerDown };
}
