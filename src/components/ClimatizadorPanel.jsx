import { useSystem } from "../context/ConfigContext.jsx";

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" />
    </label>
  );
}

export default function ClimatizadorPanel({ climatizador, salas }) {
  const { setClimatizador } = useSystem();
  const c = climatizador;
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{c.nome}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Atende: {salas.map((s) => s.nome).join(" · ")}
          </div>
        </div>
        <Toggle checked={c.ligado} onChange={(v) => setClimatizador(c.id, { ligado: v })} />
      </div>

      <div className="vav" style={{ marginTop: 8 }}>
        <span className="vav__label">Setpoint</span>
        <div className="range">
          <input
            type="range"
            min="16"
            max="30"
            step="0.5"
            value={c.setpoint}
            disabled={!c.ligado}
            onChange={(e) => setClimatizador(c.id, { setpoint: Number(e.target.value) })}
          />
          <strong style={{ width: 52, textAlign: "right" }}>{c.setpoint.toFixed(1)}°C</strong>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <span className="pill" style={{ background: c.ligado ? "rgba(46,139,87,.12)" : "var(--color-bg)", color: c.ligado ? "var(--color-success)" : "var(--color-text-muted)", borderColor: "transparent" }}>
          {c.ligado ? "● LIGADO" : "○ DESLIGADO"}
        </span>
      </div>
    </div>
  );
}
