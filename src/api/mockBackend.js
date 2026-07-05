import { STATUS } from "../theme.js";

const HISTORY_POINTS = 60; // ~ ultimos pontos por sala/metrica
const TICK_MS = 3000;

// Modelo termico do ambiente:
//  - TEMP_AMBIENTE: temperatura natural da sala sem resfriamento (carga termica).
//  - EFICIENCIA: quao perto do ar insuflado a sala chega com a VAV 100% aberta.
// Limite fisico: a sala NUNCA esfria abaixo da temperatura de insuflamento
// (principio do sistema VAV - so modula vazao de ar frio, nao muda a temperatura dele).
const TEMP_AMBIENTE = 29;
const EFICIENCIA = 0.95;

// ----- Configuracao inicial (faixas de alerta editaveis POR SALA) ----------
// Valores padrao conforme normas brasileiras para ambiente hospitalar:
//  - Umidade: 40% a 60% (ABNT NBR 7256 - tratamento de ar em EAS, areas comuns)
//  - CO2: max 1000 ppm (ANVISA RE 09/2003, base da NBR 7256; a NBR 17037:2023 usa
//    700 ppm acima do ar externo). Usamos 1000 ppm como limite critico, 800 atencao.
const defaultThresholds = () => ({
  temperatura: { min: 20, max: 26, unit: "C" },
  umidade: { min: 40, max: 60, unit: "%" },
  co2: { warn: 800, critical: 1000, unit: "ppm" },
});
// thresholds[salaId] = { temperatura, umidade, co2 }
let thresholds = {};

let ntfyConfig = {
  enabled: true,
  server: "https://ntfy.sh",
  topic: "tcc-hvac-alertas",
  minLevel: "atencao", // atencao | critico
};

// Identificacao do documento para o relatorio de auditoria (PMOC / NBR 7256).
// Campos exigidos: estabelecimento, sistema e responsavel tecnico com registro/ART.
let identificacao = {
  estabelecimento: "",
  cnes: "",
  sistema: "Sistema de Automacao HVAC",
  responsavelTecnico: "",
  registro: "", // CREA/CFT + numero da ART/TRT
};

// ----- Topologia (4 salas, 2 climatizadores, 2 banheiros) ------------------
// Sistema VAV multizona: cada sala tem seu proprio SETPOINT e a caixa VAV modula
// a vazao de ar frio para atingi-lo. Uma unica unidade central (climatizador)
// insufla ar frio para as salas que atende.
const rooms = [
  { id: "sala-1", nome: "Sala 1", climatizadorId: "clima-1", setpoint: 22 },
  { id: "sala-2", nome: "Sala 2", climatizadorId: "clima-1", setpoint: 23 },
  { id: "sala-3", nome: "Sala 3", climatizadorId: "clima-2", setpoint: 23 },
  { id: "sala-4", nome: "Sala 4", climatizadorId: "clima-2", setpoint: 24 },
].map((r) => ({
  ...r,
  temperatura: r.setpoint + (Math.random() - 0.3) * 2,
  umidade: 48 + Math.random() * 6,
  co2: 440 + Math.random() * 120,
  vav: { abertura: 40, estado: "ok", modo: "auto", motivo: "estavel" },
  ultimaLeitura: new Date().toISOString(),
}));

// Climatizador = unidade central de resfriamento (AHU). Insufla ar frio a
// "tempInsuflamento" (constante, ~13-16 C). Liga/desliga a producao de frio;
// quem regula a temperatura de cada sala e a VAV.
const climatizadores = [
  { id: "clima-1", nome: "Climatizador A", salas: ["sala-1", "sala-2"], ligado: true, tempInsuflamento: 15 },
  { id: "clima-2", nome: "Climatizador B", salas: ["sala-3", "sala-4"], ligado: true, tempInsuflamento: 15 },
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

// ----- Log de auditoria (rastreabilidade - NBR 7256 / PMOC Lei 13.589/2018) -
// Registra alertas, acoes do operador, falhas e snapshots ambientais periodicos.
// No backend real, cada evento e persistido na tabela SQLite `eventos`.
let eventos = [];
let evSeq = 1;
let booted = false; // evita registrar eventos durante o pre-aquecimento
let snapCount = 0;
const SNAPSHOT_EVERY = 40; // registro ambiental periodico (~2 min com tick de 3s)

// Sala alimentada por FONTE EXTERNA (ESP32 real via MQTT); null = todas simuladas.
let externalRoom = null;

function logEvento(categoria, descricao, opts = {}) {
  if (!booted) return;
  eventos = [
    {
      id: `ev-${evSeq++}`,
      ts: new Date().toISOString(),
      categoria, // alerta | reconhecimento | parametro | setpoint | vav | climatizador | exaustao | registro
      descricao,
      salaId: opts.salaId || null,
      origem: opts.origem || "sistema", // sistema | operador
    },
    ...eventos,
  ].slice(0, 1000);
}

function nomeDaSala(salaId) {
  return rooms.find((r) => r.id === salaId)?.nome || salaId || "-";
}

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
  logEvento("alerta", `[${level.toUpperCase()}] ${mensagem}`, { salaId, origem: "sistema" });
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

  // Demanda de resfriamento: controle proporcional ao erro em relacao ao
  // SETPOINT DA PROPRIA SALA. So ha resfriamento se a unidade central estiver ligada.
  let coolDemand = 0;
  if (climaLigado) {
    const erro = room.temperatura - room.setpoint; // > 0 = acima do alvo
    coolDemand = Math.max(5, Math.min(100, 40 + erro * 120));
  }

  // Demanda de ventilacao a partir do CO2 (renova o ar)
  let ventDemand;
  if (room.co2 >= t.co2.critical) ventDemand = 100;
  else if (room.co2 >= t.co2.warn)
    ventDemand = 50 + ((room.co2 - t.co2.warn) / (t.co2.critical - t.co2.warn)) * 50;
  else ventDemand = (room.co2 / t.co2.warn) * 20; // renovacao minima

  const target = Math.max(coolDemand, ventDemand);
  // Motivo baseado no ESTADO real da sala, nao so na abertura:
  //  - sem_frio: unidade central desligada (VAV nao consegue resfriar)
  //  - ventilacao: renovacao de ar (CO2) manda mais que o resfriamento
  //  - resfriamento: sala acima do alvo, puxando a temperatura para baixo
  //  - regime: sala no alvo, VAV so mantendo (modulacao parcial e normal)
  let motivo;
  const erro = room.temperatura - room.setpoint;
  if (!climaLigado) motivo = "sem_frio";
  else if (ventDemand > coolDemand) motivo = "ventilacao";
  else if (erro > 0.4) motivo = "resfriamento";
  else motivo = "regime";
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

    // 2) Fisica do ambiente. Salas com FONTE EXTERNA (ESP32 via MQTT) nao sao
    // simuladas: seus valores vem de ingestTelemetry(). As demais sao simuladas.
    if (r.id !== externalRoom) {
      // A sala tende a uma temperatura de equilibrio que depende da vazao de ar frio:
      //  - VAV fechada -> tende a TEMP_AMBIENTE; VAV 100% -> ~temperatura de insuflamento.
      // A sala nunca esfria abaixo do ar insuflado, por mais que a VAV abra.
      if (clima && clima.ligado) {
        const alvoFisico =
          clima.tempInsuflamento + (TEMP_AMBIENTE - clima.tempInsuflamento) * (1 - EFICIENCIA * (r.vav.abertura / 100));
        r.temperatura = drift(r.temperatura + (alvoFisico - r.temperatura) * 0.25, 0.08, 12, 40);
      } else {
        r.temperatura = drift(r.temperatura + (TEMP_AMBIENTE - r.temperatura) * 0.15, 0.12, 12, 40);
      }
      const umidAlvo = clima && clima.ligado ? 50 : 58;
      r.umidade = drift(r.umidade + (umidAlvo - r.umidade) * 0.08, 0.7, 25, 80);
      const co2Delta = 10 - (r.vav.abertura / 100) * 45;
      r.co2 = drift(r.co2 + co2Delta, 16, 420, 2000);
      r.ultimaLeitura = now;
    }

    pushHistory(r.id, "temperatura", r.temperatura);
    pushHistory(r.id, "umidade", r.umidade);
    pushHistory(r.id, "co2", r.co2);
  });
  evaluateAlerts();

  // Registro ambiental periodico (rastreabilidade continua)
  if (booted && ++snapCount >= SNAPSHOT_EVERY) {
    snapCount = 0;
    const resumo = rooms
      .map((r) => `${r.nome}: ${r.temperatura.toFixed(1)}°C / ${r.umidade.toFixed(0)}% / ${r.co2.toFixed(0)}ppm`)
      .join(" | ");
    logEvento("registro", `Registro ambiental — ${resumo}`, { origem: "sistema" });
  }
}

function pushHistory(roomId, metric, value) {
  const arr = history[roomId][metric];
  arr.push({ t: new Date().toISOString(), value: Number(value.toFixed(1)) });
  if (arr.length > HISTORY_POINTS) arr.shift();
}

// pre-popula o historico para os graficos ja terem dados (sem registrar eventos)
for (let i = 0; i < HISTORY_POINTS; i++) tick();
booted = true; // a partir daqui os eventos passam a ser registrados
logEvento("registro", "Sistema de supervisao iniciado", { origem: "sistema" });

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
      salas: rooms.map((r) => ({ ...r, status: roomStatus(r), fonte: r.id === externalRoom ? "ESP32" : "MOCK" })),
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
    const t = thresholds[salaId];
    logEvento(
      "parametro",
      `Faixas de alerta de ${nomeDaSala(salaId)} alteradas — temp ${t.temperatura.min}-${t.temperatura.max}°C, umidade ${t.umidade.min}-${t.umidade.max}%, CO2 ${t.co2.warn}/${t.co2.critical}ppm`,
      { salaId, origem: "operador" }
    );
    return clone(thresholds);
  },
  getAlerts() {
    return clone(alerts);
  },
  acknowledgeAlert(id) {
    const alvo = alerts.find((a) => a.id === id);
    alerts = alerts.map((a) => (a.id === id ? { ...a, reconhecido: true } : a));
    if (alvo) logEvento("reconhecimento", `Alerta reconhecido: ${alvo.mensagem}`, { salaId: alvo.salaId, origem: "operador" });
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
      logEvento("vav", `${nomeDaSala(roomId)}: VAV ajustada manualmente para ${r.vav.abertura}%`, { salaId: roomId, origem: "operador" });
    }
    return clone(r);
  },
  // alterna entre controle automatico e manual
  setVavMode(roomId, modo) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      r.vav.modo = modo === "manual" ? "manual" : "auto";
      if (r.vav.modo === "auto") r.vav.motivo = "estavel";
      logEvento("vav", `${nomeDaSala(roomId)}: modo da VAV alterado para ${r.vav.modo.toUpperCase()}`, { salaId: roomId, origem: "operador" });
    }
    return clone(r);
  },
  setVavFault(roomId, falha) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      r.vav.estado = falha ? "falha" : "ok";
      logEvento("vav", `${nomeDaSala(roomId)}: falha de VAV ${falha ? "registrada" : "normalizada"}`, {
        salaId: roomId,
        origem: falha ? "sistema" : "operador",
      });
    }
    return clone(r);
  },
  // define o setpoint de temperatura (alvo) de uma sala
  setRoomSetpoint(roomId, setpoint) {
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      const antigo = r.setpoint;
      r.setpoint = Math.max(16, Math.min(30, Number(setpoint)));
      if (antigo !== r.setpoint)
        logEvento("setpoint", `${nomeDaSala(roomId)}: setpoint alterado de ${antigo}°C para ${r.setpoint}°C`, { salaId: roomId, origem: "operador" });
    }
    return clone(r);
  },
  setClimatizador(id, patch) {
    const c = climatizadores.find((x) => x.id === id);
    if (c) {
      Object.assign(c, patch);
      if ("ligado" in patch) logEvento("climatizador", `${c.nome} ${c.ligado ? "ligado" : "desligado"}`, { origem: "operador" });
      if ("tempInsuflamento" in patch) logEvento("climatizador", `${c.nome}: temperatura de insuflamento ajustada para ${c.tempInsuflamento}°C`, { origem: "operador" });
    }
    return clone(c);
  },
  setBathroomLight(id, luz) {
    const b = bathrooms.find((x) => x.id === id);
    if (b) b.luz = luz;
    const exaustao = bathrooms.some((x) => x.luz);
    if (b) logEvento("exaustao", `${b.nome}: luz ${luz ? "ligada" : "desligada"} → exaustor ${exaustao ? "LIGADO" : "DESLIGADO"} (lógica OR)`, { origem: "operador" });
    // intertravamento: a exaustao segue a logica OR das luzes
    return clone({ banheiros: bathrooms, exaustao: { ligada: exaustao, logica: "OR" } });
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
  // log de auditoria completo (rastreabilidade)
  getEvents() {
    return clone(eventos);
  },
  // identificacao do documento (estabelecimento / responsavel tecnico)
  getIdentificacao() {
    return clone(identificacao);
  },
  saveIdentificacao(next) {
    identificacao = { ...identificacao, ...next };
    logEvento("registro", "Identificacao do relatorio de auditoria atualizada", { origem: "operador" });
    return clone(identificacao);
  },
  // injeta uma leitura "do Arduino/ESP32" (mesma forma do POST /api/telemetria)
  ingestTelemetry(payload) {
    const r = rooms.find((x) => x.id === payload.salaId);
    if (!r) return { ok: false };
    if (payload.temperatura != null) r.temperatura = Number(payload.temperatura);
    if (payload.umidade != null) r.umidade = Number(payload.umidade);
    if (payload.co2 != null) r.co2 = Number(payload.co2);
    r.ultimaLeitura = new Date().toISOString();
    evaluateAlerts();
    return { ok: true };
  },
  // define qual sala e alimentada por fonte externa (ESP32). null = nenhuma.
  setFonteExterna(salaId) {
    externalRoom = rooms.some((r) => r.id === salaId) ? salaId : null;
    if (externalRoom) logEvento("registro", `${nomeDaSala(externalRoom)} vinculada a fonte externa (ESP32 via MQTT)`, { salaId: externalRoom, origem: "operador" });
    return { externalRoom };
  },
};
