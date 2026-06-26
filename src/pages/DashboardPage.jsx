import { useSystem } from "../context/ConfigContext.jsx";
import RoomCard from "../components/RoomCard.jsx";
import ClimatizadorPanel from "../components/ClimatizadorPanel.jsx";
import BathroomExhaust from "../components/BathroomExhaust.jsx";
import TelemetryChart from "../components/TelemetryChart.jsx";
import { STATUS, palette } from "../theme.js";

function Stat({ label, value, color }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: color || palette.text }}>
        {value}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { state, alerts, thresholds, error } = useSystem();

  if (error && !state) {
    return <div className="banner">Falha ao conectar com a API: {error}</div>;
  }
  if (!state) {
    return <div className="empty">Carregando dados do sistema…</div>;
  }

  const salas = state.salas;
  const criticas = salas.filter((s) => Object.values(s.status).includes(STATUS.CRITICO)).length;
  const atencao = salas.filter((s) => {
    const v = Object.values(s.status);
    return !v.includes(STATUS.CRITICO) && v.includes(STATUS.ATENCAO);
  }).length;
  const alertasAtivos = alerts.filter((a) => !a.reconhecido).length;

  return (
    <>
      {state.conexao?.fonte === "MOCK" && (
        <div className="banner">
          <span>ℹ️</span>
          <span>
            Exibindo <strong>dados simulados</strong>. Ajuste os controles (VAV, climatizadores, luzes) para ver o
            sistema reagir e os alertas dispararem. Para usar o Arduino real, configure <code>VITE_API_MODE=real</code>.
          </span>
        </div>
      )}

      <div className="stat-row">
        <Stat label="Salas monitoradas" value={salas.length} />
        <Stat label="Salas em atencao" value={atencao} color={atencao ? palette.warning : palette.text} />
        <Stat label="Salas criticas" value={criticas} color={criticas ? palette.critical : palette.success} />
        <Stat label="Alertas ativos" value={alertasAtivos} color={alertasAtivos ? palette.critical : palette.success} />
        <Stat
          label="Exaustao banheiros"
          value={state.exaustao?.ligada ? "LIGADA" : "Desligada"}
          color={state.exaustao?.ligada ? palette.success : palette.text}
        />
      </div>

      <div className="section-title">Salas</div>
      <div className="grid grid--rooms">
        {salas.map((s) => (
          <RoomCard key={s.id} room={s} climatizador={state.climatizadores.find((c) => c.id === s.climatizadorId)} />
        ))}
      </div>

      <div className="section-title">Climatizadores</div>
      <div className="grid grid--2">
        {state.climatizadores.map((c) => (
          <ClimatizadorPanel
            key={c.id}
            climatizador={c}
            salas={salas.filter((s) => c.salas.includes(s.id))}
          />
        ))}
      </div>

      <div className="section-title">Telemetria e Exaustao</div>
      <div className="grid grid--2">
        <TelemetryChart salas={salas} thresholds={thresholds} />
        <BathroomExhaust banheiros={state.banheiros} exaustao={state.exaustao} />
      </div>
    </>
  );
}
