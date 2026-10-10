import type { Notice, NoticeKind } from "@/core/types";

/**
 * Groups Malaysian mobiles (+60 11-1428 2835, +60 12-345 6789). Others are returned as given:
 * country codes are 1 to 3 digits, so grouping without a lookup table would guess wrong.
 */
export function formatPhone(raw: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  const my = digits.match(/^\+?60(1\d)(\d{7,8})$/);
  if (my) {
    const [, prefix, rest] = my;
    const head = rest.length === 8 ? rest.slice(0, 4) : rest.slice(0, 3);
    return `+60 ${prefix}-${head} ${rest.slice(head.length)}`;
  }
  return raw;
}

/** Proton Link labels messages loosely, so the kind comes from the label and the text. */
function kindOf(label: string | undefined, title: string, body: string): NoticeKind | undefined {
  const text = `${label ?? ""} ${title} ${body}`;
  if (/vehicle\s*control|remote (?:engine|start|lock|unlock|control|command)|command (?:sent|executed|failed)/i.test(text)) return "command";
  if (/login|security|password|account/i.test(text)) return "security";
  if (/service|maintenance|appointment/i.test(text)) return "service";
  return undefined;
}

/** Some messages arrive with an empty title; others in CamelCase ("ServiceReminder"). */
function titleOf(label: string | undefined, title: string, body: string) {
  if (title) {
    const spaced = title.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return spaced === title ? title : spaced.charAt(0) + spaced.slice(1).toLowerCase();
  }
  const text = `${label ?? ""} ${body}`;
  if (/logged in|login|sign(ed)? in/i.test(text)) return "New login";
  if (/service|maintenance|appointment/i.test(text)) return "Service reminder";
  return "Message";
}

/** Tidies raw values Proton pastes in ("2026-09-24 09:52:57", "ANDROID"); times are already local. */
function tidyBody(text: string) {
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?\b/g, (_, y, mo, d, h, mi) => {
      const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0));
      if (Number.isNaN(date.getTime())) return _;
      const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      return h == null ? day : `${day}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    })
    .replace(/\bANDROID\b/g, "Android")
    .replace(/\bIOS\b/g, "iOS");
}

export function formatNotice(raw: { title?: string; body?: string; label?: string }): Pick<Notice, "title" | "body" | "kind"> {
  const title = raw.title?.trim() ?? "";
  const body = raw.body?.trim() ?? "";
  return {
    title: titleOf(raw.label, title, body),
    body: body ? tidyBody(body) : undefined,
    kind: kindOf(raw.label, title, body),
  };
}
