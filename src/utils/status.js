import { STATUS_GAMES } from "../constants.js";

// Higher = worse; drives the "worst status" chip on cards and in the status view.
export const SEVERITY = { ok: 0, unknown: 1, minor: 2, guest: 3, off: 4, down: 5 };

export function getGameEntry(arcade, gameKey) {
  return arcade?.machineStatus?.[gameKey] ?? null;
}

// Worst status key across a list of cab entries (drives row tinting).
export function worstStatusOf(cabs) {
  const statusOf = (c) => c.status ?? "unknown";
  return (cabs ?? []).reduce((w, c) => (SEVERITY[statusOf(c)] > SEVERITY[w] ? statusOf(c) : w), "ok");
}

// entry = arcade.machineStatus[gameKey] -> { total, ok, worst } | null
export function summarizeGame(entry) {
  const cabs = entry?.cabs ?? [];
  if (!cabs.length) return null;
  const statusOf = (c) => c.status ?? "unknown";
  return {
    total: cabs.length,
    ok: cabs.filter((c) => statusOf(c) === "ok").length,
    worst: worstStatusOf(cabs),
  };
}

// Group a flat cabs[] by cabinet id, preserving first-appearance order.
// Returns [{ id, key, entries: [{ cab, idx }] }]: `idx` is the index in the
// flat array; `key` is unique (blank ids get their own group, keyed "#idx")
// so it is safe to use as a React key.
export function groupCabs(cabs) {
  const groups = [];
  const byId = new Map();
  (cabs ?? []).forEach((cab, idx) => {
    const id = cab.id ?? "";
    const key = id.trim() ? id.trim() : `#${idx}`; // blanks never merge
    let g = byId.get(key);
    if (!g) {
      g = { id, key, entries: [] };
      byId.set(key, g);
      groups.push(g);
    }
    g.entries.push({ cab, idx });
  });
  return groups;
}

export function arcadeHasStatus(arcade) {
  return STATUS_GAMES.some((k) => {
    const e = getGameEntry(arcade, k);
    return !!e && ((e.cabs?.length ?? 0) > 0 || !!e.version || !!e.notes);
  });
}

// "2026-05-24" -> "24 May 2026"; "" / null / invalid -> ""
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

// Current date in Singapore (UTC+8) as "YYYY-MM-DD". Status edits are stamped
// with it on save, regardless of the editor's local timezone.
export function todaySG() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
