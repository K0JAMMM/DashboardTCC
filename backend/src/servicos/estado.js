// ---------------------------------------------------------------------------
// Camada de AGREGACAO (framework, parte 1 - camadas).
//
// Problema que resolve: o backend guarda os dados normalizados, exatamente
// como a DER define (7 tabelas). O dashboard React, porem, foi escrito contra
// o contrato de docs/API_CONTRACT.md - um objeto "estado" ja montado, com
// status calculado e tudo aninhado por sala. Sem esta camada, GET /api/estado
// nem existia: o modo VITE_API_MODE=real nao tinha o que consumir.
//
// montarEstado() e o adaptador entre as duas pontas: le as tabelas cruas via
// SQL e devolve exatamente o formato que useSystem()/DashboardPage/RoomCard/
// ClimatizadorPanel ja esperam - assim, uma sala criada via provisionamento.js
// (ou inserida manualmente) aparece no dashboard sem tocar em nenhum
// componente.
//
// Limite atual (proposital, fora do escopo desta etapa): esta camada so
// cobre LEITURA (GET /api/estado). As acoes de escrita da dashboard em modo
// real (setVav, setVavMode, setRoomSetpoint, ligar/desligar climatizador,
// exaustao dos banheiros) ainda nao tem rota dedicada aqui - hoje so
// funcionam no modo mock. Fica registrado como proximo passo.
// ---------------------------------------------------------------------------

import { db } from "../banco/db.js";

const METRICAS = ["temperatura", "umidade", "co2"];

function ultimaLeitura(idSensor) {
  return db
    .prepare("SELECT valor, data_hora FROM LEITURA_SENSOR WHERE id_sensor = ? ORDER BY id_leitura DESC LIMIT 1")
    .get(idSensor);
}

function statusMetrica(valor, limite) {
  if (valor == null || !limite) return "normal";
  if (limite.valor_min != null && valor < limite.valor_min) return "critico";
  if (limite.valor_max != null && valor > limite.valor_max) return "critico";
  return "normal";
}

function montarSala(salaRow, todasSalas) {
  const sensores = db.prepare("SELECT * FROM SENSOR WHERE id_sala = ?").all(salaRow.id_sala);
  const limites = db.prepare("SELECT * FROM LIMITE_ALERTA WHERE id_sala = ?").all(salaRow.id_sala);
  const vavRow = db.prepare("SELECT * FROM VAV WHERE id_sala = ?").get(salaRow.id_sala);

  const valores = {};
  const status = {};
  let ultimaTs = null;

  for (const tipo of METRICAS) {
    const sensor = sensores.find((s) => s.tipo === tipo);
    const limite = limites.find((l) => l.tipo === tipo);
    let valor = null;

    if (sensor) {
      const leitura = ultimaLeitura(sensor.id_sensor);
      if (leitura) {
        valor = leitura.valor;
        if (!ultimaTs || leitura.data_hora > ultimaTs) ultimaTs = leitura.data_hora;
      }
    }
    valores[tipo] = valor;
    status[tipo] = statusMetrica(valor, limite);
  }

  return {
    id: salaRow.id_sala,
    nome: salaRow.nome,
    andar: salaRow.andar,
    climatizadorId: salaRow.id_climatizador,
    setpoint: salaRow.setpoint,
    temperatura: valores.temperatura,
    umidade: valores.umidade,
    co2: valores.co2,
    vav: vavRow
      ? {
          abertura: vavRow.abertura,
          estado: vavRow.status === "falha" ? "falha" : "ok",
          modo: vavRow.modo || "auto",
          motivo: vavRow.motivo || "estavel",
        }
      : { abertura: 0, estado: "ok", modo: "auto", motivo: "estavel" },
    ultimaLeitura: ultimaTs,
    status,
  };
}

function montarClimatizador(climaRow, salasRows) {
  return {
    id: climaRow.id_climatizador,
    nome: climaRow.nome,
    salas: salasRows.filter((s) => s.id_climatizador === climaRow.id_climatizador).map((s) => s.id_sala),
    ligado: !!climaRow.ligado,
    tempInsuflamento: climaRow.temp_insuflamento,
  };
}

// Monta o objeto completo consumido por GET /api/estado (mesmo formato do
// mockBackend.js no frontend, ver docs/API_CONTRACT.md secao 1).
export function montarEstado() {
  const salasRows = db.prepare("SELECT * FROM SALA").all();
  const climaRows = db.prepare("SELECT * FROM CLIMATIZADOR").all();

  return {
    timestamp: new Date().toISOString(),
    conexao: { online: true, fonte: "REST" },
    salas: salasRows.map((s) => montarSala(s, salasRows)),
    climatizadores: climaRows.map((c) => montarClimatizador(c, salasRows)),
    // BANHEIRO ainda nao existe na DER (fora do escopo desta etapa) - o
    // dashboard trata array vazio e exaustao desligada sem quebrar.
    banheiros: [],
    exaustao: { ligada: false, logica: "OR" },
  };
}
