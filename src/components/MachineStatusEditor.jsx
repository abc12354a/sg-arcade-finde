import { useState } from "react";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { GAMES, STATUS, STATUS_GAMES } from "../constants.js";
import { groupCabs, todaySG } from "../utils/status.js";
import { IconChevron } from "./icons.jsx";

const GAME_LABELS = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));

// Stable per-cabinet row tag: entries sharing an id share a row; blank ids
// get their own row, so retyping an id mid-edit never merges/splits rows
// (which would drop input focus). _row never reaches Firestore — handleSave
// rebuilds each cab from explicit fields.
function tagRows(cabs) {
  const out = [];
  groupCabs(cabs).forEach((g, gi) => {
    g.entries.forEach(({ cab }) => out.push({ ...cab, _row: `r${gi}` }));
  });
  return out;
}

// Rows keyed by _row (stable), not by id — see tagRows.
function rowsFromCabs(cabs) {
  const rows = [];
  const byRow = new Map();
  cabs.forEach((cab, idx) => {
    let r = byRow.get(cab._row);
    if (!r) {
      r = { rowKey: cab._row, id: cab.id, entries: [] };
      byRow.set(cab._row, r);
      rows.push(r);
    }
    r.entries.push({ cab, idx });
  });
  return rows;
}

// Deep-copy the arcade's machineStatus into editable form state, always with
// both status-game keys present. Sides are "" for none (chunithm is
// single-sided). Cabs are tagged into stable cabinet rows (see tagRows).
function normalizeStatus(arcade) {
  const out = {};
  for (const g of STATUS_GAMES) {
    const e = arcade?.machineStatus?.[g];
    out[g] = {
      version: e?.version ?? "",
      notes: e?.notes ?? "",
      cabs: tagRows(
        (e?.cabs ?? []).map((c) => ({
          id: c.id ?? "",
          side: c.side ?? "",
          status: c.status ?? "unknown",
          note: c.note ?? "",
          reportedAt: c.reportedAt ?? "",
        })),
      ),
    };
  }
  return out;
}

// One cabinet row: single id input + per-side status icon toggles; expand for
// per-side note/date editing, adding a missing side, or removal.
function MseRow({ game, row, onUpdate, onRemove, onAddSide }) {
  const [open, setOpen] = useState(false);
  const twoSided = game === "maimai";
  const rowIdxs = row.entries.map((e) => e.idx);
  return (
    <div className={`mse-row${open ? " open" : ""}`}>
      <div className="mse-row-top">
        <input
          className="mse-id-input"
          value={row.entries[0].cab.id}
          onChange={(e) => onUpdate(rowIdxs, { id: e.target.value })}
          placeholder="A317"
          aria-label="Cabinet id"
        />
        <div className="mse-sides">
          {row.entries.map(({ cab, idx }) => (
            <span key={idx} className="mse-side">
              {twoSided && <span className="mse-side-label">{cab.side || "—"}</span>}
              <span
                className="mse-st-group"
                role="group"
                aria-label={`Status ${cab.side || ""}`.trim()}
              >
                {STATUS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`mse-st s-${s.key}${cab.status === s.key ? " on" : ""}`}
                    aria-pressed={cab.status === s.key}
                    title={s.label}
                    onClick={() => onUpdate([idx], { status: s.key })}
                  >
                    <span aria-hidden="true">{s.emoji}</span>
                    <span className="sr-only">{s.short}</span>
                  </button>
                ))}
              </span>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="mse-expand"
          aria-expanded={open}
          aria-label="Toggle details"
          onClick={() => setOpen((o) => !o)}
        >
          <IconChevron size={16} className="cab-chevron" />
        </button>
      </div>
      {open && (
        <div className="mse-row-detail">
          {row.entries.map(({ cab, idx }) => (
            <div key={idx} className="mse-side-block">
              {twoSided && <div className="mse-side-head">{cab.side || "—"}</div>}
              <label>
                <span>Note</span>
                <input
                  value={cab.note}
                  onChange={(e) => onUpdate([idx], { note: e.target.value })}
                  placeholder="e.g. 1P button 6 drops inputs"
                />
              </label>
              <label>
                <span>Last reported</span>
                <input
                  type="date"
                  value={cab.reportedAt || ""}
                  onChange={(e) => onUpdate([idx], { reportedAt: e.target.value })}
                />
              </label>
              <button type="button" className="clear-btn danger" onClick={() => onRemove([idx])}>
                Remove side
              </button>
            </div>
          ))}
          {twoSided &&
            ["1P", "2P"]
              .filter((s) => !row.entries.some((e) => e.cab.side === s))
              .map((s) => (
                <button key={s} type="button" className="clear-btn" onClick={() => onAddSide(row, s)}>
                  + Add {s}
                </button>
              ))}
          {row.entries.length > 1 && (
            <button type="button" className="clear-btn danger" onClick={() => onRemove(rowIdxs)}>
              Remove cabinet
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Per-arcade machine status editor (opened from the admin table's "Status" action).
// Saves only the machineStatus field with merge, so nothing else on the doc moves.
export default function MachineStatusEditor({ arcade, onDone, onCancel }) {
  const [form, setForm] = useState(() => normalizeStatus(arcade));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setField = (game, key) => (e) =>
    setForm((f) => ({ ...f, [game]: { ...f[game], [key]: e.target.value } }));

  // Patch one cab ([idx]) or a whole cabinet row (all its indices, e.g. when
  // renaming the cabinet id).
  const updateCabs = (game, idxs, patch) =>
    setForm((f) => ({
      ...f,
      [game]: {
        ...f[game],
        cabs: f[game].cabs.map((c, i) => (idxs.includes(i) ? { ...c, ...patch } : c)),
      },
    }));

  // Add a whole cabinet: maimai gets both sides, chunithm a single entry.
  // The fresh _row can't collide with existing rows.
  const addCab = (game) =>
    setForm((f) => {
      const row = `new-${Date.now()}`;
      const base = { id: "", status: "ok", note: "", reportedAt: "", _row: row };
      const cabs =
        game === "maimai"
          ? [...f[game].cabs, { ...base, side: "1P" }, { ...base, side: "2P" }]
          : [...f[game].cabs, { ...base, side: "" }];
      return { ...f, [game]: { ...f[game], cabs } };
    });

  const removeCabs = (game, idxs) =>
    setForm((f) => ({
      ...f,
      [game]: { ...f[game], cabs: f[game].cabs.filter((_, i) => !idxs.includes(i)) },
    }));

  // Append a missing side (maimai only), joining the row's cabinet id.
  const addSide = (game, row, side) =>
    setForm((f) => ({
      ...f,
      [game]: {
        ...f[game],
        cabs: [
          ...f[game].cabs,
          { id: row.id, side, status: "ok", note: "", reportedAt: "", _row: row.rowKey },
        ],
      },
    }));

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const today = todaySG();
      const payload = {};
      for (const g of STATUS_GAMES) {
        // Original cabs keyed by id|side, so edits/inserts/deletions anywhere
        // in the row list still pair with the right stored row.
        const origByKey = new Map(
          (arcade?.machineStatus?.[g]?.cabs ?? []).map((c) => [`${c.id}|${c.side ?? ""}`, c])
        );
        const cabs = form[g].cabs
          .map((c) => {
            const next = {
              id: c.id.trim(),
              side: g === "maimai" ? c.side || "1P" : null,
              status: c.status,
              note: c.note.trim(),
            };
            const orig = origByKey.get(`${next.id}|${next.side ?? ""}`);
            // A cab that changed (or is new) is being reported now: stamp it
            // with today's date unless the editor deliberately picked one.
            const changed =
              !orig ||
              next.id !== (orig.id ?? "") ||
              next.side !== (orig.side ?? null) ||
              next.status !== (orig.status ?? "unknown") ||
              next.note !== (orig.note ?? "");
            const datePicked = !!orig && c.reportedAt !== (orig.reportedAt ?? "");
            return { ...next, reportedAt: changed && !datePicked ? today : c.reportedAt || null };
          })
          .filter((c) => c.id);
        const version = form[g].version.trim();
        const notes = form[g].notes.trim();
        // A game cleared to nothing has its entry deleted from the doc;
        // surviving entries get asOf = save date.
        payload[g] =
          cabs.length || version || notes
            ? { version, notes, asOf: today, cabs }
            : deleteField();
      }
      await setDoc(doc(db, "arcades", arcade.id), { machineStatus: payload }, { merge: true });
      onDone();
    } catch (err) {
      setError(err.message?.replace("Firebase: ", "") || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form" onSubmit={handleSave}>
      <div className="admin-form-head">
        <h3>Status — {arcade.branch}</h3>
        <button type="button" className="clear-btn" onClick={onCancel}>← Back to list</button>
      </div>

      {STATUS_GAMES.map((g) => {
        const rows = rowsFromCabs(form[g].cabs);
        return (
          <fieldset key={g} className="mse-game">
            <legend>{GAME_LABELS[g]} · {rows.length} cabinets · {form[g].cabs.length} entries</legend>
            <div className="mse-meta">
              <label><span>Version</span>
                <input value={form[g].version} onChange={setField(g, "version")} placeholder="1.65-A" /></label>
              <label><span>Location notes</span>
                <textarea rows={2} value={form[g].notes} onChange={setField(g, "notes")}
                  placeholder="Fans installed, layout notes, …" /></label>
            </div>
            {rows.length > 0 ? (
              <div className="mse-rows">
                {rows.map((row) => (
                  <MseRow
                    key={row.rowKey}
                    game={g}
                    row={row}
                    onUpdate={(idxs, patch) => updateCabs(g, idxs, patch)}
                    onRemove={(idxs) => removeCabs(g, idxs)}
                    onAddSide={(r, side) => addSide(g, r, side)}
                  />
                ))}
              </div>
            ) : (
              <p className="dim">No cabs recorded</p>
            )}
            <div className="mse-actions">
              <button type="button" className="clear-btn" onClick={() => addCab(g)}>+ Add cabinet</button>
            </div>
          </fieldset>
        );
      })}

      <p className="dim-note">
        Saving stamps “info as of” — and the reported date of cabs you changed — with today’s date (SG, UTC+8).
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="admin-actions">
        <button type="submit" className="submit-btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="clear-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
