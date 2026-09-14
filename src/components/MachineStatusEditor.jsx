import { useState } from "react";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { GAMES, STATUS, STATUS_GAMES } from "../constants.js";
import { todaySG } from "../utils/status.js";

const GAME_LABELS = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));

// Deep-copy the arcade's machineStatus into editable form state, always with
// both status-game keys present. Sides are "" for none (chunithm is single-sided).
function normalizeStatus(arcade) {
  const out = {};
  for (const g of STATUS_GAMES) {
    const e = arcade?.machineStatus?.[g];
    out[g] = {
      version: e?.version ?? "",
      notes: e?.notes ?? "",
      cabs: (e?.cabs ?? []).map((c) => ({
        id: c.id ?? "",
        side: c.side ?? "",
        status: c.status ?? "unknown",
        note: c.note ?? "",
        reportedAt: c.reportedAt ?? "",
      })),
    };
  }
  return out;
}

// Per-arcade machine status editor (opened from the admin table's "Status" action).
// Saves only the machineStatus field with merge, so nothing else on the doc moves.
export default function MachineStatusEditor({ arcade, onDone, onCancel }) {
  const [form, setForm] = useState(() => normalizeStatus(arcade));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setField = (game, key) => (e) =>
    setForm((f) => ({ ...f, [game]: { ...f[game], [key]: e.target.value } }));

  const updateCab = (game, idx, patch) =>
    setForm((f) => ({
      ...f,
      [game]: {
        ...f[game],
        cabs: f[game].cabs.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
      },
    }));

  const addCab = (game) =>
    setForm((f) => ({
      ...f,
      [game]: {
        ...f[game],
        cabs: [
          ...f[game].cabs,
          { id: "", side: game === "maimai" ? "1P" : "", status: "ok", note: "", reportedAt: "" },
        ],
      },
    }));

  const removeCab = (game, idx) =>
    setForm((f) => ({ ...f, [game]: { ...f[game], cabs: f[game].cabs.filter((_, i) => i !== idx) } }));

  async function handleSave(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const today = todaySG();
      const payload = {};
      for (const g of STATUS_GAMES) {
        // Original cabs keyed by id|side, so edits/inserts/deletions anywhere
        // in the table still pair with the right stored row.
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

      {STATUS_GAMES.map((g) => (
        <fieldset key={g} className="mse-game">
          <legend>{GAME_LABELS[g]} · {form[g].cabs.length} entries</legend>
          <div className="mse-meta">
            <label><span>Version</span>
              <input value={form[g].version} onChange={setField(g, "version")} placeholder="1.65-A" /></label>
            <label><span>Location notes</span>
              <textarea rows={2} value={form[g].notes} onChange={setField(g, "notes")}
                placeholder="Fans installed, layout notes, …" /></label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table mse-table">
              <thead>
                <tr><th>Cab</th><th>Side</th><th>Status</th><th>Note</th><th>Last reported</th><th></th></tr>
              </thead>
              <tbody>
                {form[g].cabs.map((cab, idx) => (
                  <tr key={idx}>
                    <td><input value={cab.id} onChange={(e) => updateCab(g, idx, { id: e.target.value })}
                      placeholder="A317" /></td>
                    <td>
                      {g === "maimai" ? (
                        <select value={cab.side || "1P"} onChange={(e) => updateCab(g, idx, { side: e.target.value })}>
                          <option value="1P">1P</option>
                          <option value="2P">2P</option>
                        </select>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td>
                      <select value={cab.status} onChange={(e) => updateCab(g, idx, { status: e.target.value })}>
                        {STATUS.map((s) => (
                          <option key={s.key} value={s.key}>{s.emoji} {s.short}</option>
                        ))}
                      </select>
                    </td>
                    <td><input value={cab.note} onChange={(e) => updateCab(g, idx, { note: e.target.value })}
                      placeholder="e.g. 1P button 6 drops inputs" /></td>
                    <td><input type="date" value={cab.reportedAt || ""}
                      onChange={(e) => updateCab(g, idx, { reportedAt: e.target.value })} /></td>
                    <td className="row-actions">
                      <button type="button" className="danger" onClick={() => removeCab(g, idx)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {form[g].cabs.length === 0 && (
                  <tr><td colSpan={6} className="dim">No cabs recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mse-actions">
            <button type="button" className="clear-btn" onClick={() => addCab(g)}>+ Add cab</button>
          </div>
        </fieldset>
      ))}

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
