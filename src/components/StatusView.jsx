import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { CHAINS, CHAIN_COLORS, GAMES, STATUS, STATUS_BY_KEY, STATUS_GAMES } from "../constants.js";
import { arcadeHasStatus, formatDate, getGameEntry, groupCabs, summarizeGame, worstStatusOf } from "../utils/status.js";
import MachineStatusEditor from "./MachineStatusEditor.jsx";
import { IconChevron } from "./icons.jsx";

const GAME_LABEL = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1yR7zAoR0DErE5iigS-VMBo4Cm5vlHP46gQsjW-t0MYc/htmlview";

// One cabinet row: collapsed = id + per-side status slots, click to expand
// each side's details (status label, note, report date).
function CabRow({ group, gameKey }) {
  const [open, setOpen] = useState(false);
  const twoSided = gameKey === "maimai";
  const worst = worstStatusOf(group.entries.map((e) => e.cab));
  // Deterministic slots: maimai always shows 1P then 2P (a missing side gets
  // a dashed placeholder), odd sides appended; other games one slot per entry.
  const slots = twoSided
    ? [
        { side: "1P", entry: group.entries.find((e) => e.cab.side === "1P") },
        { side: "2P", entry: group.entries.find((e) => e.cab.side === "2P") },
        ...group.entries
          .filter((e) => e.cab.side !== "1P" && e.cab.side !== "2P")
          .map((e) => ({ side: e.cab.side || "", entry: e })),
      ]
    : group.entries.map((e) => ({ side: null, entry: e }));

  return (
    <div className={`cab-row s-${worst}${open ? " open" : ""}`}>
      <button
        type="button"
        className="cab-row-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <strong className="cab-row-id">{group.id}</strong>
        <span className="cab-row-slots">
          {slots.map(({ side, entry }, i) => {
            if (!entry) {
              return (
                <span key={`empty-${i}`} className="cab-slot cab-slot-empty" title="Not listed">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">not listed</span>
                </span>
              );
            }
            const status = STATUS_BY_KEY[entry.cab.status] ?? STATUS_BY_KEY.unknown;
            const title = [
              `${side ? `${side}: ` : ""}${status.label}`,
              entry.cab.note,
              entry.cab.reportedAt ? `reported ${formatDate(entry.cab.reportedAt)}` : null,
            ].filter(Boolean).join("\n");
            return (
              <span key={`${side}-${i}`} className={`cab-slot s-${status.key}`} title={title}>
                {twoSided && <span className="cab-slot-side">{side}</span>}
                <span className="sr-only">{`${side ? `${side} ` : ""}${status.short}`}</span>
                <span aria-hidden="true">{status.emoji}</span>
                {entry.cab.note && (
                  <span className="cab-slot-dot" aria-hidden="true" title="Has notes">◆</span>
                )}
              </span>
            );
          })}
        </span>
        <IconChevron size={16} className="cab-chevron" />
      </button>
      {open && (
        <div className="cab-row-detail">
          {group.entries.map(({ cab, idx }) => {
            const status = STATUS_BY_KEY[cab.status] ?? STATUS_BY_KEY.unknown;
            return (
              <div key={idx} className="cab-detail">
                <div className="cab-detail-head">
                  {twoSided && <span className="cab-side">{cab.side || "—"}</span>}
                  <span><span aria-hidden="true">{status.emoji}</span> {status.short}</span>
                </div>
                {cab.note && <p className="cab-note">{cab.note}</p>}
                <span className="cab-date">
                  {cab.reportedAt ? `reported ${formatDate(cab.reportedAt)}` : "no report date"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GameStatusBlock({ gameKey, entry }) {
  const sum = summarizeGame(entry);
  if (!sum) return null;
  return (
    <div className="game-status">
      <div className="game-status-head">
        <span className={`game-badge g-${gameKey}`}>{GAME_LABEL[gameKey]}</span>
        {entry.version && <span className="version-chip">v{entry.version}</span>}
        <span className="game-status-sum">{sum.ok}/{sum.total} OK</span>
        {entry.asOf && <span className="as-of">info as of {formatDate(entry.asOf)}</span>}
      </div>
      {entry.notes && <p className="game-status-notes">{entry.notes}</p>}
      <div className="cab-rows">
        {groupCabs(entry.cabs).map((group) => (
          <CabRow key={group.key} group={group} gameKey={gameKey} />
        ))}
      </div>
    </div>
  );
}

// Public machine-status view, one arcade at a time: pick a location, see its
// cabinet rows. Admins can jump straight into the editor from here.
export default function StatusView({ arcades, focus, onExit }) {
  const { isAdmin } = useAuth();
  const withStatus = useMemo(() => arcades.filter(arcadeHasStatus), [arcades]);
  const [selectedId, setSelectedId] = useState(focus ?? withStatus[0]?.id ?? arcades[0]?.id ?? null);
  const [editing, setEditing] = useState(false);

  const arcade = arcades.find((a) => a.id === selectedId) ?? withStatus[0] ?? arcades[0];

  // Picker options grouped by chain (known chains first, then any others)
  const groups = useMemo(() => {
    const present = [...new Set(arcades.map((a) => a.chain))];
    const ordered = [
      ...CHAINS.filter((c) => present.includes(c)),
      ...present.filter((c) => !CHAINS.includes(c)).sort(),
    ];
    return ordered.map((chain) => ({ chain, list: arcades.filter((a) => a.chain === chain) }));
  }, [arcades]);

  if (!arcade) {
    return (
      <section className="status-view">
        <div className="admin-form-head">
          <h2>Machine status</h2>
          <button type="button" className="clear-btn" onClick={onExit}>← Back to map</button>
        </div>
        <p className="empty-state">No arcades loaded.</p>
      </section>
    );
  }

  if (editing && isAdmin) {
    return (
      <section className="status-view">
        <MachineStatusEditor
          key={arcade.id}
          arcade={arcade}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  const noCabs = !STATUS_GAMES.some((gk) => summarizeGame(getGameEntry(arcade, gk)));

  return (
    <section className="status-view">
      <div className="admin-form-head">
        <h2>Machine status</h2>
        <button type="button" className="clear-btn" onClick={onExit}>← Back to map</button>
      </div>

      <div className="status-legend">
        {STATUS.map((s) => (
          <span key={s.key} title={s.label}>{s.emoji} {s.short}</span>
        ))}
        <span className="dim-note">
          Statuses change only when admins update them; “reported” dates are the last community report.
        </span>
      </div>

      <div className="status-picker">
        <select
          value={arcade.id}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Choose an arcade"
        >
          {groups.map(({ chain, list }) => (
            <optgroup key={chain} label={chain}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.branch}{arcadeHasStatus(a) ? "" : " · no status"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {isAdmin && (
          <button type="button" className="submit-btn" onClick={() => setEditing(true)}>
            ✎ Edit
          </button>
        )}
      </div>

      <article className="status-arcade">
        <header>
          <h4>{arcade.branch}</h4>
          <span className="chain-badge" style={{ background: CHAIN_COLORS[arcade.chain] || "#64748b" }}>
            {arcade.chain}
          </span>
          {STATUS_GAMES.map((gk) =>
            arcade.prices?.[gk] ? (
              <span key={gk} className="price-chip">{GAME_LABEL[gk]}: {arcade.prices[gk]}</span>
            ) : null
          )}
        </header>
        {STATUS_GAMES.map((gk) => {
          const entry = getGameEntry(arcade, gk);
          return entry ? (
            <GameStatusBlock key={`${arcade.id}:${gk}`} gameKey={gk} entry={entry} />
          ) : null;
        })}
        {noCabs && (
          <p className="dim-note">No machine status recorded for this arcade yet.</p>
        )}
      </article>

      <p className="sheet-link">
        Originally sourced from the{" "}
        <a href={SHEET_URL} target="_blank" rel="noreferrer">maimai &amp; CHUNITHM SG public sheet</a>.
      </p>
    </section>
  );
}
