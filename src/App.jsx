import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useSystem } from "./context/ConfigContext.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ParametrosPage from "./pages/ParametrosPage.jsx";
import AlertasPage from "./pages/AlertasPage.jsx";
import LogsPage from "./pages/LogsPage.jsx";
import SensorAoVivoPage from "./pages/SensorAoVivoPage.jsx";

function Sidebar({ alertCount }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span style={{ fontSize: 22 }}>❄️</span>
        <div>
          HVAC Supervisao
          <small>AUTOMACAO PREDIAL · TCC</small>
        </div>
      </div>
      <NavLink to="/" end className="nav-link">
        <span className="ico">▦</span> Dashboard
      </NavLink>
      <NavLink to="/parametros" className="nav-link">
        <span className="ico">⚙</span> Parametros
      </NavLink>
      <NavLink to="/alertas" className="nav-link">
        <span className="ico">🔔</span> Alertas
        {alertCount > 0 && (
          <span className="pill" style={{ marginLeft: "auto", background: "#fff", color: "#0F4C81" }}>
            {alertCount}
          </span>
        )}
      </NavLink>
      <NavLink to="/logs" className="nav-link">
        <span className="ico">📋</span> Auditoria
      </NavLink>
      <NavLink to="/ao-vivo" className="nav-link">
        <span className="ico">📡</span> Sensor ao vivo
      </NavLink>
      <div className="sidebar__footer">
        ESP32 · MQTT · API REST · ntfy.sh
        <br />4 salas · 2 climatizadores · 2 banheiros
      </div>
    </aside>
  );
}

function Topbar({ title }) {
  const { state, mode } = useSystem();
  const online = state?.conexao?.online;
  const ts = state?.timestamp ? new Date(state.timestamp).toLocaleTimeString("pt-BR") : "--";
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="topbar__meta">
        <span className="tag-source">{mode === "mock" ? "DADOS SIMULADOS" : "BACKEND REAL"}</span>
        <span>Atualizado: {ts}</span>
        <span className={`conn-dot ${online ? "" : "offline"}`}>{online ? "Online" : "Offline"}</span>
      </div>
    </header>
  );
}

const TITLES = {
  "/": "Visao Geral",
  "/parametros": "Parametros e Alertas",
  "/alertas": "Central de Alertas",
  "/logs": "Auditoria e Rastreabilidade",
  "/ao-vivo": "Sensor ao Vivo (ESP32)",
};

export default function App() {
  const { alerts } = useSystem();
  const active = alerts.filter((a) => !a.reconhecido).length;
  return (
    <div className="app-shell">
      <Sidebar alertCount={active} />
      <div className="main">
        <Routes>
          <Route path="/" element={<Page title={TITLES["/"]}><DashboardPage /></Page>} />
          <Route path="/parametros" element={<Page title={TITLES["/parametros"]}><ParametrosPage /></Page>} />
          <Route path="/alertas" element={<Page title={TITLES["/alertas"]}><AlertasPage /></Page>} />
          <Route path="/logs" element={<Page title={TITLES["/logs"]}><LogsPage /></Page>} />
          <Route path="/ao-vivo" element={<Page title={TITLES["/ao-vivo"]}><SensorAoVivoPage /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function Page({ title, children }) {
  return (
    <>
      <Topbar title={title} />
      <main className="content">{children}</main>
    </>
  );
}
