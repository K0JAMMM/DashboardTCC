import { mock, startSimulation } from "./mockBackend.js";

const MODE = import.meta.env.VITE_API_MODE === "real" ? "real" : "mock";
const BASE = import.meta.env.VITE_API_BASE || "/api";

if (MODE === "mock") startSimulation();

async function http(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  if (res.status === 204) return null;
  return res.json();
}

// Pequeno atraso para simular latencia de rede no modo mock.
const tick = (v) => new Promise((r) => setTimeout(() => r(v), 120));

export const api = {
  mode: MODE,

  // GET /api/estado  -> estado completo do sistema
  getSystemState() {
    return MODE === "mock" ? tick(mock.getSystemState()) : http("/estado");
  },

  // GET /api/historico/:salaId/:metrica
  getHistory(roomId, metric) {
    return MODE === "mock"
      ? tick(mock.getHistory(roomId, metric))
      : http(`/historico/${roomId}/${metric}`);
  },

  // GET /api/parametros  -> mapa { salaId: { temperatura, umidade, co2 } }
  getThresholds() {
    return MODE === "mock" ? tick(mock.getThresholds()) : http("/parametros");
  },

  // PUT /api/parametros/:salaId  -> atualiza as faixas de uma sala
  saveThresholds(salaId, next) {
    return MODE === "mock"
      ? tick(mock.saveThresholds(salaId, next))
      : http(`/parametros/${salaId}`, { method: "PUT", body: JSON.stringify(next) });
  },

  // GET /api/alertas
  getAlerts() {
    return MODE === "mock" ? tick(mock.getAlerts()) : http("/alertas");
  },

  // POST /api/alertas/:id/reconhecer
  acknowledgeAlert(id) {
    return MODE === "mock"
      ? tick(mock.acknowledgeAlert(id))
      : http(`/alertas/${id}/reconhecer`, { method: "POST" });
  },

  // DELETE /api/alertas/reconhecidos
  clearAcknowledged() {
    return MODE === "mock"
      ? tick(mock.clearAcknowledged())
      : http("/alertas/reconhecidos", { method: "DELETE" });
  },

  // PUT /api/salas/:salaId/vav   { abertura }  (override manual)
  setVav(roomId, abertura) {
    return MODE === "mock"
      ? tick(mock.setVav(roomId, abertura))
      : http(`/salas/${roomId}/vav`, { method: "PUT", body: JSON.stringify({ abertura }) });
  },

  // PUT /api/salas/:salaId/vav/modo   { modo: "auto" | "manual" }
  setVavMode(roomId, modo) {
    return MODE === "mock"
      ? tick(mock.setVavMode(roomId, modo))
      : http(`/salas/${roomId}/vav/modo`, { method: "PUT", body: JSON.stringify({ modo }) });
  },

  // PUT /api/salas/:salaId/setpoint   { setpoint }  (alvo de temperatura da sala)
  setRoomSetpoint(roomId, setpoint) {
    return MODE === "mock"
      ? tick(mock.setRoomSetpoint(roomId, setpoint))
      : http(`/salas/${roomId}/setpoint`, { method: "PUT", body: JSON.stringify({ setpoint }) });
  },

  // (demo) forca falha de VAV - util para testar o alerta de falha
  setVavFault(roomId, falha) {
    return MODE === "mock"
      ? tick(mock.setVavFault(roomId, falha))
      : http(`/salas/${roomId}/vav/falha`, { method: "PUT", body: JSON.stringify({ falha }) });
  },

  // PUT /api/climatizadores/:id   { ligado, setpoint }
  setClimatizador(id, patch) {
    return MODE === "mock"
      ? tick(mock.setClimatizador(id, patch))
      : http(`/climatizadores/${id}`, { method: "PUT", body: JSON.stringify(patch) });
  },

  // PUT /api/banheiros/:id   { luz }  (dispara intertravamento OR da exaustao)
  setBathroomLight(id, luz) {
    return MODE === "mock"
      ? tick(mock.setBathroomLight(id, luz))
      : http(`/banheiros/${id}`, { method: "PUT", body: JSON.stringify({ luz }) });
  },

  // GET / PUT /api/ntfy
  getNtfyConfig() {
    return MODE === "mock" ? tick(mock.getNtfyConfig()) : http("/ntfy");
  },
  saveNtfyConfig(next) {
    return MODE === "mock"
      ? tick(mock.saveNtfyConfig(next))
      : http("/ntfy", { method: "PUT", body: JSON.stringify(next) });
  },
  // GET /api/ntfy/log  -> notificacoes enviadas
  getNtfyLog() {
    return MODE === "mock" ? tick(mock.getNtfyLog()) : http("/ntfy/log");
  },

  // GET /api/eventos  -> log de auditoria (rastreabilidade)
  getEvents() {
    return MODE === "mock" ? tick(mock.getEvents()) : http("/eventos");
  },

  // GET / PUT /api/identificacao  -> dados do estabelecimento / responsavel tecnico
  getIdentificacao() {
    return MODE === "mock" ? tick(mock.getIdentificacao()) : http("/identificacao");
  },
  saveIdentificacao(next) {
    return MODE === "mock"
      ? tick(mock.saveIdentificacao(next))
      : http("/identificacao", { method: "PUT", body: JSON.stringify(next) });
  },

  // POST /api/telemetria  -> injeta leitura de sensor (ESP32) numa sala
  ingestTelemetry(payload) {
    return MODE === "mock"
      ? tick(mock.ingestTelemetry(payload))
      : http("/telemetria", { method: "POST", body: JSON.stringify(payload) });
  },
  // PUT /api/fonte-externa  -> define qual sala usa dados reais do ESP32
  setFonteExterna(salaId) {
    return MODE === "mock"
      ? tick(mock.setFonteExterna(salaId))
      : http("/fonte-externa", { method: "PUT", body: JSON.stringify({ salaId }) });
  },
};
