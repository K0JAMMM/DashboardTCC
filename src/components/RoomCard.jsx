import { useState, useEffect } from "react";
import { useSystem } from "../context/ConfigContext.jsx";
import { statusColor, STATUS } from "../theme.js";
import StatusBadge from "./StatusBadge.jsx";

function Metric({ label, icon, value, unit, status, digits = 1 }) {
  return (
    <div className="metric">
      <div className="metric__label">
        <span>{icon}</span> {label}
      </div>
      <div className="metric__value" style={{ color: statusColor[status] }}>
        {Number(value).toFixed(digits)}
        <span className="metric__unit"> {unit}</span>
      </div>
    </div>
  );
}

const MOTIVO = {
  estavel: { txt: "Estável", cor: "var(--color-success)" },
  resfriamento: { txt: "Resfriando", cor: "var(--color-secondary)" },
  ventilacao: { txt: "Ventilando (CO₂)", cor: "var(--color-warning)" },
  manual: { txt: "Manual", cor: "var(--color-text-muted)" },
};

export default function RoomCard({ room, climatizador }) {
  const { setVav, setVavMode, setVavFault } = useSystem();
  const auto = room.vav.modo !== "manual";
  const [manualVal, setManualVal] = useState(room.vav.abertura);

  // mantem o slider manual sincronizado quando o valor muda fora dele
  useEffect(() => {
    if (!auto) setManualVal(room.vav.abertura);
  }, [room.vav.abertura, auto]);

  const overall = (() => {
    const s = room.status;
    if (Object.values(s).includes(STATUS.CRITICO)) return STATUS.CRITICO;
    if (Object.values(s).includes(STATUS.ATENCAO)) return STATUS.ATENCAO;
    return STATUS.NORMAL;
  })();

  const motivo = MOTIVO[room.vav.motivo] || MOTIVO.estavel;
  const barColor = room.vav.estado === "falha" ? "var(--color-critical)" : motivo.cor;

  return (
    <div className="room">
      <div className="room__head">
        <div>
          <div className="room__name">{room.nome}</div>
          <div className="room__sub">{climatizador ? climatizador.nome : "sem climatizador"}</div>
        </div>
        <StatusBadge status={overall} />
      </div>

      <div className="room__metrics">
        <Metric label="Temp." icon="🌡️" value={room.temperatura} unit="°C" status={room.status.temperatura} />
        <Metric label="Umidade" icon="💧" value={room.umidade} unit="%" status={room.status.umidade} digits={0} />
        <Metric label="CO₂" icon="🫁" value={room.co2} unit="ppm" status={room.status.co2} digits={0} />
      </div>

      <div className="room__foot">
        {/* Cabecalho da VAV: rotulo + seletor de modo */}
        <div className="row-between">
          <span className="vav__label">VAV — fluxo de ar</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={`btn ${auto ? "btn--primary" : "btn--ghost"}`}
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setVavMode(room.id, "auto")}
            >
              Auto
            </button>
            <button
              className={`btn ${!auto ? "btn--primary" : "btn--ghost"}`}
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setVavMode(room.id, "manual")}
            >
              Manual
            </button>
          </div>
        </div>

        {/* Barra de abertura (sempre visivel) */}
        <div>
          <div className="row-between" style={{ marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {auto ? (
                <>
                  Automático · <strong style={{ color: motivo.cor }}>{motivo.txt}</strong>
                </>
              ) : (
                "Controle manual"
              )}
            </span>
            <strong style={{ fontSize: 13 }}>{room.vav.abertura}%</strong>
          </div>
          <div style={{ height: 10, background: "var(--color-bg)", borderRadius: 999, overflow: "hidden", border: "1px solid var(--color-border)" }}>
            <div
              style={{
                width: `${room.vav.abertura}%`,
                height: "100%",
                background: barColor,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>

        {/* Slider so aparece no modo manual */}
        {!auto && (
          <div className="range">
            <input
              type="range"
              min="0"
              max="100"
              value={manualVal}
              onChange={(e) => setManualVal(Number(e.target.value))}
              onMouseUp={(e) => setVav(room.id, Number(e.target.value))}
              onTouchEnd={(e) => setVav(room.id, Number(e.target.value))}
            />
            <strong style={{ width: 42, textAlign: "right" }}>{manualVal}%</strong>
          </div>
        )}

        <div className="row-between">
          <span className="muted" style={{ fontSize: 12 }}>
            Estado VAV:{" "}
            <strong style={{ color: room.vav.estado === "falha" ? "var(--color-critical)" : "var(--color-success)" }}>
              {room.vav.estado === "falha" ? "FALHA" : "OK"}
            </strong>
          </span>
          <button
            className="btn btn--ghost"
            style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={() => setVavFault(room.id, room.vav.estado !== "falha")}
            title="Simula uma falha de VAV para testar o alerta"
          >
            {room.vav.estado === "falha" ? "Limpar falha" : "Simular falha"}
          </button>
        </div>
      </div>
    </div>
  );
}
