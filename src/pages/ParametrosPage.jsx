import { useEffect, useState } from "react";
import { useSystem } from "../context/ConfigContext.jsx";
import { api } from "../api/client.js";

function Field({ label, value, onChange, step = "1", min }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" step={step} min={min} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function ParametrosPage() {
  const { state, thresholds, saveThresholds } = useSystem();
  const salas = state?.salas || [];

  const [salaId, setSalaId] = useState(null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  // ntfy
  const [ntfy, setNtfy] = useState(null);
  const [ntfySaved, setNtfySaved] = useState(false);

  // seleciona a primeira sala assim que os dados chegam
  useEffect(() => {
    if (!salaId && salas.length) setSalaId(salas[0].id);
  }, [salas, salaId]);

  // carrega as faixas da sala selecionada no formulario
  useEffect(() => {
    if (salaId && thresholds && thresholds[salaId]) {
      setForm(JSON.parse(JSON.stringify(thresholds[salaId])));
    }
  }, [salaId, thresholds]);

  useEffect(() => {
    api.getNtfyConfig().then(setNtfy);
  }, []);

  const upd = (group, key, val) =>
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: Number(val) } }));

  const handleSave = async () => {
    await saveThresholds(salaId, form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // aplica as faixas da sala atual para todas as outras salas
  const aplicarTodas = async () => {
    for (const s of salas) {
      await saveThresholds(s.id, form);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSaveNtfy = async () => {
    const next = await api.saveNtfyConfig(ntfy);
    setNtfy(next);
    setNtfySaved(true);
    setTimeout(() => setNtfySaved(false), 2500);
  };

  const nomeSala = salas.find((s) => s.id === salaId)?.nome || "";

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card__title">Faixas de Alerta por Sala</h3>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
          Cada sala tem suas próprias faixas. Valores fora da faixa geram alarme crítico;
          próximos da borda geram atenção. Os alertas são enviados via ntfy.sh.
        </p>

        {/* Seletor de sala */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 4px" }}>
          {salas.map((s) => (
            <button
              key={s.id}
              className={`btn ${salaId === s.id ? "btn--primary" : "btn--ghost"}`}
              style={{ padding: "7px 14px", fontSize: 14 }}
              onClick={() => setSalaId(s.id)}
            >
              {s.nome}
            </button>
          ))}
        </div>

        {!form ? (
          <div className="empty">Carregando parametros…</div>
        ) : (
          <>
            <div style={{ fontWeight: 700, margin: "14px 0 2px", color: "var(--color-primary)" }}>
              Editando: {nomeSala}
            </div>

            <div className="form-row">
              <div className="param-title">🌡️ Temperatura</div>
              <Field label="Minimo (°C)" value={form.temperatura.min} step="0.5" onChange={(v) => upd("temperatura", "min", v)} />
              <Field label="Maximo (°C)" value={form.temperatura.max} step="0.5" onChange={(v) => upd("temperatura", "max", v)} />
            </div>

            <div className="form-row">
              <div className="param-title">💧 Umidade</div>
              <Field label="Minimo (%)" value={form.umidade.min} onChange={(v) => upd("umidade", "min", v)} />
              <Field label="Maximo (%)" value={form.umidade.max} onChange={(v) => upd("umidade", "max", v)} />
            </div>

            <div className="form-row">
              <div className="param-title">🫁 CO₂ / Qualidade do ar</div>
              <Field label="Atencao (ppm)" value={form.co2.warn} step="50" onChange={(v) => upd("co2", "warn", v)} />
              <Field label="Critico (ppm)" value={form.co2.critical} step="50" onChange={(v) => upd("co2", "critical", v)} />
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn--primary" onClick={handleSave}>
                Salvar faixas de {nomeSala}
              </button>
              <button className="btn btn--ghost" onClick={aplicarTodas} title="Copia estas faixas para todas as salas">
                Aplicar a todas as salas
              </button>
              {saved && <span style={{ color: "var(--color-success)", fontWeight: 600 }}>✓ Parametros salvos</span>}
            </div>
          </>
        )}
      </div>

      {ntfy && (
        <div className="card">
          <h3 className="card__title">Notificacoes ntfy.sh</h3>
          <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
            O backend envia os alertas para este topico. Assine pelo app ntfy ou em{" "}
            <code>{ntfy.server}/{ntfy.topic}</code>.
          </p>

          <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Servidor</label>
              <input value={ntfy.server} onChange={(e) => setNtfy({ ...ntfy, server: e.target.value })} />
            </div>
            <div className="field">
              <label>Topico</label>
              <input value={ntfy.topic} onChange={(e) => setNtfy({ ...ntfy, topic: e.target.value })} />
            </div>
          </div>
          <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Nivel minimo p/ notificar</label>
              <select value={ntfy.minLevel} onChange={(e) => setNtfy({ ...ntfy, minLevel: e.target.value })}>
                <option value="atencao">Atencao e acima</option>
                <option value="critico">Somente criticos</option>
              </select>
            </div>
            <div className="field">
              <label>Ativo</label>
              <select value={ntfy.enabled ? "1" : "0"} onChange={(e) => setNtfy({ ...ntfy, enabled: e.target.value === "1" })}>
                <option value="1">Sim</option>
                <option value="0">Nao</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
            <button className="btn btn--primary" onClick={handleSaveNtfy}>
              Salvar ntfy
            </button>
            {ntfySaved && <span style={{ color: "var(--color-success)", fontWeight: 600 }}>✓ Configuracao salva</span>}
          </div>
        </div>
      )}
    </>
  );
}
