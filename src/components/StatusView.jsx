import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { CHAINS, CHAIN_COLORS, GAMES, STATUS, STATUS_BY_KEY, STATUS_GAMES } from "../constants.js";
import { arcadeHasStatus, formatDate, getGameEntry, summarizeGame } from "../utils/status.js";
import MachineStatusEditor from "./MachineStatusEditor.jsx";

const GAME_LABEL = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1yR7zAoR0DErE5iigS-VMBo4Cm5vlHP46gQsjW-t0MYc/htmlview";

function CabCell({ cab }) {
  const status = STATUS_BY_KEY[cab.status] ?? STATUS_BY_KEY.unknown;
  return (
    <div
      className={`cab-cell s-${status.key}`}
      title={cab.note || `${cab.id} ${cab.side ?? ""}`.trim()}
    >
      <div className="cab-head">
        <strong>{cab.id}</strong>
        {cab.side && <span className="cab-side">{cab.side}</span>}
        <span className="cab-status" aria-label={status.short}>{status.emoji}</span>
      </div>
      {cab.note && <p className="cab-note">{cab.note}</p>}
      <span className="cab-date">
        {cab.reportedAt ? `reported ${formatDate(cab.reportedAt)}` : "no report date"}
      </span>
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
      <div className="cab-grid">
        {(entry.cabs ?? []).map((cab, i) => (
          <CabCell key={`${cab.id}-${cab.side ?? "x"}-${i}`} cab={cab} />
        ))}
      </div>
    </div>
  );
}

// Public machine-status view, one arcade at a time: pick a location, see its
// cab grid. Admins can jump straight into the editor from here.
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
          <span key={s.key}>{s.emoji} {s.label}</span>
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
          return entry ? <GameStatusBlock key={gk} gameKey={gk} entry={entry} /> : null;
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
