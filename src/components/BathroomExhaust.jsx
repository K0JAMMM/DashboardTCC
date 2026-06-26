import { useSystem } from "../context/ConfigContext.jsx";

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" />
    </label>
  );
}

// Exaustao compartilhada acionada por logica OR a partir das luzes.
export default function BathroomExhaust({ banheiros, exaustao }) {
  const { setBathroomLight } = useSystem();
  return (
    <div className="card">
      <h3 className="card__title">Exaustao dos Banheiros (intertravamento OR)</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {banheiros.map((b) => (
          <div key={b.id} className="row-between">
            <span className="vav__label">💡 Luz — {b.nome}</span>
            <Toggle checked={b.luz} onChange={(v) => setBathroomLight(b.id, v)} />
          </div>
        ))}
      </div>

      <div
        className="row-between"
        style={{
          marginTop: 16,
          padding: "12px 14px",
          borderRadius: 10,
          background: exaustao.ligada ? "rgba(46,139,87,.12)" : "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontWeight: 700 }}>🌀 Exaustor</span>
        <span
          style={{
            fontWeight: 800,
            color: exaustao.ligada ? "var(--color-success)" : "var(--color-text-muted)",
          }}
        >
          {exaustao.ligada ? "LIGADO" : "DESLIGADO"}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Logica: luz_ban1 <strong>OR</strong> luz_ban2 → exaustor
      </div>
    </div>
  );
}
