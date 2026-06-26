import { STATUS } from "../theme.js";

const HISTORY_POINTS = 60; // ~ ultimos pontos por sala/metrica
const TICK_MS = 3000;

// ----- Configuracao inicial (faixas de alerta editaveis POR SALA) ----------
const defaultThresholds = () => ({
  temperatura: { min: 20, max: 26, unit: "C" },
  umidade: { min: 40, max: 60, unit: "%" },
  co2: { warn: 800, critical: 1200, unit: "ppm" }, // escala inspirada no AQI/EPA
});
// thresholds[salaId] = { temperatura, umidade, co2 }
let thresholds = {};

let ntfyConfig = {
  enabled: true,
  server: "https://ntfy.sh",
  topic: "tcc-hvac-alertas",
  minLevel: "atencao", // atencao | critico
};

// ----- Topologia (4 salas, 2 climatizadores, 2 banheiros) ------------------
const rooms = [
  { id: "sala-1", nome: "Sala 1", climatizadorId: "clima-1" },
  { id: "sala-2", nome: "Sala 2", climatizadorId: "clima-1" },
  { id: "sala-3", nome: "Sala 3", climatizadorId: "clima-2" },
  { id: "sala-4", nome: "Sala 4", climatizadorId: "clima-2" },
].map((r) => ({
  ...r,
  temperatura: 22 + Math.random() * 2,
  umidade: 48 + Math.random() * 6,
  co2: 440 + Math.random() * 120,
  vav: { abertura: 60, estado: "ok", modo: "auto", motivo: "estavel" },
  ultimaLeitura: new Date().toISOString(),
}));

const climatizadores = [
  { id: "clima-1", nome: "Climatizador A", salas: ["sala-1", "sala-2"], ligado: true, setpoint: 23 },
  { id: "clima-2", nome: "Climatizador B", salas: ["sala-3", "sala-4"], ligado: true, setpoint: 23 },
];

const bathrooms = [
  { id: "ban-1", nome: "Banheiro 1", luz: false },
  { id: "ban-2", nome: "Banheiro 2", luz: false },
];

const history = {}; 
rooms.forEach((r) => {
  history[r.id] = { temperatura: [], umidade: [], co2: [] };
  thresholds[r.id] = defaultThresholds(); // cada sala comeca com a faixa padrao
});

let alerts = []; 
let ntfyLog = []; 
let alertSeq = 1;
const activeAlertKeys = new Set(); 

// ----- Avaliacao de status (usa as faixas da propria sala) -----------------
function statusTemperatura(v, t) {
  const { min, max } = t.temperatura;
  const margem = 1;
  if (v < min || v > max) return STATUS.CRITICO;
  if (v < min + margem || v > max - margem) return STATUS.ATENCAO;
  return STATUS.NORMAL;
}
function statusUmidade(v, t) {
  const { min, max } = t.umidade;
  const margem = 5;
  if (v < min || v > max) return STATUS.CRITICO;
  if (v < min + margem || v > max - margem) return STATUS.ATENCAO;
  return STATUS.NORMAL;
}
function statusCo2(v, t) {
  const { warn, critical } = t.co2;
  if (v >= critical) return STATUS.CRITICO;
  if (v >= warn) return STATUS.ATENCAO;
  return STATUS.NORMAL;
}

export function roomStatus(room) {
  const t = thresholds[room.id] || defaultThresholds();
  return {
    temperatura: statusTemperatura(room.temperatura, t),
    umidade: statusUmidade(room.umidade, t),
    co2: statusCo2(room.co2, t),
  };
}

export function worstStatus(statusObj) {
  const vals = Object.values(statusObj);
  if (vals.includes(STATUS.CRITICO)) return STATUS.CRITICO;
  if (vals.includes(STATUS.ATENCAO)) return STATUS.ATENCAO;
  return STATUS.NORMAL;
}

// ----- Geracao de alertas + ntfy ------------------------------------------
function levelRank(level) {
  return level === "critico" ? 2 : level === "atencao" ? 1 : 0;
}

function pushAlert(level, tipo, mensagem, salaId) {
  const key = `${salaId || "sys"}:${tipo}:${level}`;
  if (activeAlertKeys.has(key)) return; // ja existe alerta ativo identico
  activeAlertKeys.add(key);
  const alert = {
    id: `alt-${alertSeq++}`,
    level,
    tipo,
    mensagem,
    salaId: salaId || null,
    ts: new Date().toISOString(),
    reconhecido: false,
    key,
  };
  alerts = [alert, ...alerts].slice(0, 100);
  sendToNtfy(alert);
}

// Simula o POST que o backend faria para o ntfy.sh.
function sendToNtfy(alert) {
  if (!ntfyConfig.enabled) return;
  if (levelRank(alert.level) < levelRank(ntfyConfig.minLevel)) return;
  const entry = {
    id: alert.id,
    ts: alert.ts,
    url: `${ntfyConfig.server}/${ntfyConfig.topic}`,
    priority: alert.level === "critico" ? "urgent" : "high",
    title: alert.level === "critico" ? "HVAC - ALARME CRITICO" : "HVAC - Atencao",
    message: alert.mensagem,
    tags: alert.level === "critico" ? ["rotating_light"] : ["warning"],
  };
  ntfyLog = [entry, ...ntfyLog].slice(0, 50);
  // No backend real:  POST https://ntfy.sh/<topic>  (body = message, headers Title/Priority/Tags)
}

function evaluateAlerts() {
  rooms.forEach((r) => {
    const st = roomStatus(r);
    const t = thresholds[r.id] || defaultThresholds();
    // Temperatura
    if (st.temperatura === STATUS.CRITICO) {
      pushAlert("critico", "temperatura", `${r.nome}: temperatura ${r.temperatura.toFixed(1)}C fora da faixa (${t.temperatura.min}-${t.temperatura.max}C)`, r.id);
    } else clearAlertKey(`${r.id}:temperatura:critico`);
    // Umidade
    if (st.umidade === STATUS.CRITICO) {
      pushAlert("critico", "umidade", `${r.nome}: umidade ${r.umidade.toFixed(0)}% fora da faixa (${t.umidade.min}-${t.umidade.max}%)`, r.id);
    } else clearAlertKey(`${r.id}:umidade:critico`);
    // CO2 / qualidade do ar
    if (st.co2 === STATUS.CRITICO) {
      pushAlert("critico", "co2", `${r.nome}: CO2 ${r.co2.toFixed(0)} ppm acima do limite (${t.co2.critical} ppm)`, r.id);
    } else clearAlertKey(`${r.id}:co2:critico`);
    if (st.co2 === STATUS.ATENCAO) {
      pushAlert("atencao", "co2", `${r.nome}: CO2 ${r.co2.toFixed(0)} ppm em nivel moderado`, r.id);
    } else clearAlertKey(`${r.id}:co2:atencao`);
    // Falha de VAV
    if (r.vav.estado === "falha") {
      pushAlert("critico", "vav", `${r.nome}: falha detectada na VAV`, r.id);
    } else clearAlertKey(`${r.id}:vav:critico`);
  });
}

function clearAlertKey(key) {
  activeAlertKeys.delete(key);
}

// ----- Loop de simulacao (substitui leituras vindas do Arduino via MQTT) ---
function drift(value, delta, lo, hi) {
  let v = value + (Math.random() - 0.5) * delta;
  return Math.max(lo, Math.min(hi, v));
}

// CONTROLE AUTOMATICO DA VAV
// Calcula sozinha a abertura ideal a partir do erro de temperatura (demanda de
// resfriamento) e do nivel de CO2 (demanda de ventilacao). E o que a logica de
// controle no ESP32/Arduino faz: a VAV modula sem intervencao do operador.
function autoVav(room, clima) {
  const t = thresholds[room.id] || defaultThresholds();
  const climaLigado = clima && clima.ligado;
  const setpoint = climaLigado ? clima.setpoint : room.temperatura;

  // Demanda de resfriamento (so existe se o climatizador estiver ligado)
  let coolDemand = 0;
  if (climaLigado) {
    const erro = room.temperatura - setpoint; // > 0 = quente demais
    if (erro <= -1) coolDemand = 8; // ja abaixo do alvo -> quase fechada
    else if (erro >= 2) coolDemand = 100; // muito acima -> totalmente aberta
    else coolDemand = 8 + ((erro + 1) / 3) * 92; // proporcional
  }

  // Demanda de ventilacao a partir do CO2 (renova o ar)
  let ventDemand;
  if (room.co2 >= t.co2.critical) ventDemand = 100;
  else if (room.co2 >= t.co2.warn)
    ventDemand = 50 + ((room.co2 - t.co2.warn) / (t.co2.critical - t.co2.warn)) * 50;
  else ventDemand = (room.co2 / t.co2.warn) * 40; // renovacao minima

  const target = Math.max(coolDemand, ventDemand);
  const motivo = ventDemand > coolDemand ? "ventilacao" : coolDemand > 20 ? "resfriamento" : "estavel";
  return { target: Math.max(0, Math.min(100, target)), motivo };
}

function tick() {
  const now = new Date().toISOString();
  rooms.forEach((r) => {
    const clima = climatizadores.find((c) => c.id === r.climatizadorId);

    // 1) A automacao ajusta a abertura da VAV (exceto em falha ou modo manual)
    if (r.vav.estado !== "falha" && r.vav.modo === "auto") {
      const { target, motivo } = autoVav(r, clima);
      // movimento suave do motor da VAV em direcao ao alvo
      r.vav.abertura = Math.round(r.vav.abertura + (target - r.vav.abertura) * 0.35);
      r.vav.motivo = motivo;
    }

    // 2) Fisica do ambiente reage a abertura da VAV (malha fechada)
    if (clima && clima.ligado) {
      const pull = (clima.setpoint - r.temperatura) * 0.18 * (r.vav.abertura / 100);
      r.temperatura = drift(r.temperatura + pull, 0.22, 16, 34);
    } else {
      r.temperatura = drift(r.temperatura + 0.15, 0.22, 16, 34);
    }
    r.umidade = drift(r.umidade, 1.2, 25, 80);
    // CO2: producao por ocupacao menos ventilacao proporcional a abertura.
    // Bem ventilada estabiliza ~450-650 ppm (ar externo ~400); sobe se a VAV fecha.
    const co2Delta = 14 - (r.vav.abertura / 100) * 48;
    r.co2 = drift(r.co2 + co2Delta, 18, 420, 2000);
    r.ultimaLeitura = now;

    pushHistory(r.id, "temperatura", r.temperatura);
    pushHistory(r.id, "umidade", r.umidade);
    pushHistory(r.id, "co2", r.co2);
  });
  evaluateAlerts();
}

function pushHistory(roomId, metric, value) {
  const arr = history[roomId][metric];
  arr.push({ t: new Date().toISOString(), value: Number(value.toFixed(1)) });
  if (arr.length > HISTORY_POINTS) arr.shift();
}

// pre-popula o historico para os graficos ja terem dados
for (let i = 0; i < HISTORY_POINTS; i++) tick();

let timer = null;
export function startSimulation() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
}
export function stopSimulation() {
  clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------------------
// API publica do mock (espelha os endpoints REST do backend)
// ---------------------------------------------------------------------------
function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

export const mock = {
  getSystemState() {
    return clone({
      timestamp: new Date().toISOString(),
      conexao: { online: true, fonte: "MOCK" },
      salas: rooms.map((r) => ({ ...r, status: roomStatus(r) })),
      climatizadores,
      banheiros: bathrooms.map((b) => ({ ...b })),
      exaustao: { ligada: bathrooms.some((b) => b.luz), logica: "OR" },
    });
  },
  getHistory(roomId, metric) {
    return clone(history[roomId]?.[metric] || []);
  },
  // retorna o mapa completo { salaId: { temperatura, umidade, co2 } }
  getThresholds() {
    return clone(thresholds);
  },
  // atualiza as faixas de UMA sala
  saveThresholds(salaId, next) {
    if (!thresholds[salaId]) thresholds[salaId] = defaultThresholds();
    thresholds[salaId] = { ...thresholds[salaId], ...next };
    activeAlertKeys.clear(); // reavalia com os novos limites
    evaluateAlerts();
    return clone(thresholds);
  },
  getAlerts() {
    return clone(alerts);
  },
  acknowledgeAlert(id) {
    alerts = alerts.map((a) => (a.id === id ? { ...a, reconhecido: true } : a));
    return clone(alerts);
  },
  clearAcknowledged() {
    alerts = alerts.filter((a) => !a.reconhecido);
    return clone(alerts);
  },
  // override manual da abertura (so tem efeito em modo manual)
  setVav(roomId, abertura) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      r.vav.modo = "manual";
      r.vav.abertura = Math.max(0, Math.min(100, Math.round(abertura)));
      r.vav.motivo = "manual";
    }
    return clone(r);
  },
  // alterna entre controle automatico e manual
  setVavMode(roomId, modo) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      r.vav.modo = modo === "manual" ? "manual" : "auto";
      if (r.vav.modo === "auto") r.vav.motivo = "estavel";
    }
    return clone(r);
  },
  setVavFault(roomId, falha) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) r.vav.estado = falha ? "falha" : "ok";
    return clone(r);
  },
  setClimatizador(id, patch) {
    const c = climatizadores.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
    return clone(c);
  },
  setBathroomLight(id, luz) {
    const b = bathrooms.find((x) => x.id === id);
    if (b) b.luz = luz;
    // intertravamento: a exaustao segue a logica OR das luzes
    return clone({ banheiros: bathrooms, exaustao: { ligada: bathrooms.some((x) => x.luz), logica: "OR" } });
  },
  getNtfyConfig() {
    return clone(ntfyConfig);
  },
  saveNtfyConfig(next) {
    ntfyConfig = { ...ntfyConfig, ...next };
    return clone(ntfyConfig);
  },
  getNtfyLog() {
    return clone(ntfyLog);
  },
  // injeta uma leitura "do Arduino" (mesma forma do POST /api/telemetria)
  ingestTelemetry(payload) {
    const r = rooms.find((x) => x.id === payload.salaId);
    if (!r) return { ok: false };
    if (payload.temperatura != null) r.temperatura = payload.temperatura;
    if (payload.umidade != null) r.umidade = payload.umidade;
    if (payload.co2 != null) r.co2 = payload.co2;
    r.ultimaLeitura = new Date().toISOString();
    evaluateAlerts();
    return { ok: true };
  },
};
