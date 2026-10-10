// Paint name keyword → tint; first match wins, so specific hues come before generic ones.
const PAINTS: [RegExp, string][] = [
  [/jade|teal|turquoise|aqua|cyan/i, "#2e8b82"],
  [/green|emerald|olive|lime/i, "#3f7d4f"],
  [/blue|navy|marine|ocean|sapphire|azure|cobalt/i, "#2f5fa8"],
  [/red|ruby|crimson|scarlet|maroon|burgundy|wine/i, "#b0303a"],
  [/orange|copper|bronze|sunset/i, "#c46a2b"],
  [/yellow|gold|amber/i, "#c9a227"],
  [/purple|violet|plum|lavender/i, "#6b4aa0"],
  [/brown|mocha|coffee|beige|champagne|sand|khaki/i, "#8a6f55"],
  [/white|snow|pearl|ivory|cream/i, "#e8eaee"],
  [/silver|grey|gray|titanium|graphite|gunmetal|steel/i, "#8a9099"],
  [/black|onyx|obsidian|ebony|jet/i, "#1c1e22"],
];

export function paintHex(name?: string): string | undefined {
  if (!name) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(name)) return name;
  return PAINTS.find(([re]) => re.test(name))?.[1];
}

/** Alpha-only, so there's no muddy mid-band from blending colours; draw it over the surface it fades into. */
export function tintFade(hex: string, alpha: number, steps = 8) {
  const colors: string[] = [];
  const locations: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.round(alpha * (1 - t) ** 2 * 255);
    colors.push(`${hex}${a.toString(16).padStart(2, "0")}`);
    locations.push(t);
  }
  return { colors: colors as [string, string, ...string[]], locations: locations as [number, number, ...number[]] };
}

/** "METALLIC TEAL GREEN" → "Metallic Teal Green". */
export function paintLabel(name: string) {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
