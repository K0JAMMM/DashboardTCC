import { useEffect, useState } from "react";
import { useSystem } from "../context/ConfigContext.jsx";
import { api } from "../api/client.js";

const ICON = { critico: "🚨", atencao: "⚠️", info: "ℹ️" };

function AlertItem({ alert, onAck }) {
  const level = alert.level || "info";
  return (
    <div className={`alert-item alert-item--${level}`} style={{ opacity: alert.reconhecido ? 0.55 : 1 }}>
      <span className="alert-icon">{ICON[level]}</span>
      <div className="alert-item__body">
        <div className="alert-item__title">{alert.mensagem}</div>
        <div className="alert-item__meta">
          {alert.tipo?.toUpperCase()} · {new Date(alert.ts).toLocaleString("pt-BR")}
          {alert.reconhecido && " · reconhecido"}
        </div>
      </div>
      {!alert.reconhecido && (
        <button className="btn btn--ghost" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => onAck(alert.id)}>
          Reconhecer
        </button>
      )}
    </div>
  );
}

export default function AlertasPage() {
  const { alerts, acknowledgeAlert, clearAcknowledged } = useSystem();
  const [ntfyLog, setNtfyLog] = useState([]);
  const [filter, setFilter] = useState("ativos");

  useEffect(() => {
    const load = () => api.getNtfyLog().then(setNtfyLog);
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  const filtered = alerts.filter((a) => {
    if (filter === "ativos") return !a.reconhecido;
    if (filter === "criticos") return a.level === "critico";
    return true;
  });

  return (
    <div className="grid grid--2" style={{ alignItems: "start" }}>
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h3 className="card__title" style={{ margin: 0 }}>Alertas</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {["ativos", "criticos", "todos"].map((f) => (
              <button
                key={f}
                className={`btn ${filter === f ? "btn--primary" : "btn--ghost"}`}
                style={{ padding: "5px 11px", fontSize: 12, textTransform: "capitalize" }}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">Nenhum alerta {filter === "todos" ? "" : filter}. ✓</div>
        ) : (
          filtered.map((a) => <AlertItem key={a.id} alert={a} onAck={acknowledgeAlert} />)
        )}

        {alerts.some((a) => a.reconhecido) && (
          <button className="btn btn--ghost" style={{ marginTop: 8 }} onClick={clearAcknowledged}>
            Limpar reconhecidos
          </button>
        )}
      </div>

      <div className="card">
        <h3 className="card__title">Notificacoes enviadas ao ntfy.sh</h3>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
          Registro das mensagens que o backend publicou.
        </p>
        {ntfyLog.length === 0 ? (
          <div className="empty">Nenhuma notificacao enviada ainda.</div>
        ) : (
          ntfyLog.map((n) => (
            <div key={n.id} className={`alert-item alert-item--${n.priority === "urgent" ? "critico" : "atencao"}`}>
              <span className="alert-icon">📤</span>
              <div className="alert-item__body">
                <div className="alert-item__title">{n.title}</div>
                <div className="alert-item__meta">{n.message}</div>
                <div className="alert-item__meta">
                  {n.url} · prioridade {n.priority} · {new Date(n.ts).toLocaleTimeString("pt-BR")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
