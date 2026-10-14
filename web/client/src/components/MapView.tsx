import L from "leaflet";
import { useEffect, useRef } from "react";

import type { Coordinate } from "../api.ts";

type Marker = Coordinate & { label?: string; kind?: "car" | "start" | "end" };

const COLORS = { car: "#1f6feb", start: "#15803d", end: "#c62828" };

// Leaflet's default marker needs image files; a styled circle needs none.
const pin = (kind: Marker["kind"] = "car") =>
  L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span style="display:block;width:22px;height:22px;border-radius:50%;background:${COLORS[kind]};border:3px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / .4)"></span>`,
  });

/**
 * OpenStreetMap with optional markers and a route. Fits the view to whatever is drawn.
 * Tiles come from tile.openstreetmap.org, which is fine for personal use.
 */
export function MapView({ markers = [], route, className = "map", zoom = 15 }: { markers?: Marker[]; route?: Coordinate[]; className?: string; zoom?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // The container can change size after mount (tabs, grid reflow).
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const key = JSON.stringify([markers, route?.length, route?.[0], route?.at(-1)]);
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    const points: L.LatLngExpression[] = [];
    if (route && route.length > 1) {
      const line = route.map((c) => [c.latitude, c.longitude] as L.LatLngTuple);
      L.polyline(line, { color: "#1f6feb", weight: 5, opacity: 0.85 }).addTo(group);
      points.push(...line);
    }
    for (const mk of markers) {
      const ll: L.LatLngTuple = [mk.latitude, mk.longitude];
      const marker = L.marker(ll, { icon: pin(mk.kind), title: mk.label }).addTo(group);
      if (mk.label) marker.bindTooltip(mk.label);
      points.push(ll);
    }
    if (points.length === 1) m.setView(points[0], zoom);
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
  }, [key, zoom]);

  return <div ref={el} className={className} />;
}
