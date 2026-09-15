// ---------------------------------------------------------------------------
// Camada de ACOES (framework, parte 1 - camadas).
//
// Problema que resolve: o dashboard React (modo VITE_API_MODE=real) chama
// rotas dedicadas com payload em camelCase (docs/API_CONTRACT.md secao 2,
// src/api/client.js) que nao batem 1:1 com os nomes de coluna da DER
// (ex.: "tempInsuflamento" -> CLIMATIZADOR.temp_insuflamento). O crud()
// generico de server.js so aceita o nome exato da coluna no corpo, entao
// essas acoes de escrita so funcionavam em modo mock. Este arquivo traduz o
// payload do frontend pros nomes de coluna certos e valida a entidade
// referenciada antes de gravar.
// ---------------------------------------------------------------------------

import { db } from "./db.js";

function salaExiste(idSala) {
  return db.prepare("SELECT id_sala FROM SALA WHERE id_sala = ?").get(idSala);
}

// PUT /api/salas/:salaId/vav  { abertura } -- override manual (forca modo:manual)
export function setVavAbertura(idSala, abertura) {
  if (!salaExiste(idSala)) return { ok: false, status: 404, erro: `sala ${idSala} nao existe` };
  const valor = Number(abertura);
  if (Number.isNaN(valor)) return { ok: false, status: 400, erro: "abertura precisa ser numero" };

  const aberturaClamped = Math.max(0, Math.min(100, valor));
  db.prepare("UPDATE VAV SET abertura = ?, modo = 'manual', motivo = 'manual' WHERE id_sala = ?")
    .run(aberturaClamped, idSala);

  return { ok: true, vav: db.prepare("SELECT * FROM VAV WHERE id_sala = ?").get(idSala) };
}

// PUT /api/salas/:salaId/vav/modo  { modo: "auto" | "manual" }
export function setVavModo(idSala, modo) {
  if (!salaExiste(idSala)) return { ok: false, status: 404, erro: `sala ${idSala} nao existe` };
  if (modo !== "auto" && modo !== "manual") {
    return { ok: false, status: 400, erro: "modo precisa ser 'auto' ou 'manual'" };
  }

  db.prepare("UPDATE VAV SET modo = ?, motivo = ? WHERE id_sala = ?")
    .run(modo, modo === "auto" ? "estavel" : "manual", idSala);

  return { ok: true, vav: db.prepare("SELECT * FROM VAV WHERE id_sala = ?").get(idSala) };
}

// PUT /api/salas/:salaId/vav/falha  { falha: boolean } -- simula falha de VAV (demo)
export function setVavFalha(idSala, falha) {
  if (!salaExiste(idSala)) return { ok: false, status: 404, erro: `sala ${idSala} nao existe` };

  db.prepare("UPDATE VAV SET status = ? WHERE id_sala = ?").run(falha ? "falha" : "ok", idSala);

  return { ok: true, vav: db.prepare("SELECT * FROM VAV WHERE id_sala = ?").get(idSala) };
}

// PUT /api/salas/:salaId/setpoint  { setpoint }
export function setSalaSetpoint(idSala, setpoint) {
  if (!salaExiste(idSala)) return { ok: false, status: 404, erro: `sala ${idSala} nao existe` };
  const valor = Number(setpoint);
  if (Number.isNaN(valor)) return { ok: false, status: 400, erro: "setpoint precisa ser numero" };

  const setpointClamped = Math.max(16, Math.min(30, valor)); // mesma faixa do simulador mock
  db.prepare("UPDATE SALA SET setpoint = ? WHERE id_sala = ?").run(setpointClamped, idSala);

  return { ok: true, sala: db.prepare("SELECT * FROM SALA WHERE id_sala = ?").get(idSala) };
}

// PUT /api/climatizadores/:id  { ligado?, tempInsuflamento? } -- patch parcial
export function setClimatizador(idClimatizador, patch = {}) {
  const clima = db.prepare("SELECT * FROM CLIMATIZADOR WHERE id_climatizador = ?").get(idClimatizador);
  if (!clima) return { ok: false, status: 404, erro: `climatizador ${idClimatizador} nao existe` };

  const sets = [];
  const valores = [];

  if ("ligado" in patch) {
    sets.push("ligado = ?");
    valores.push(patch.ligado ? 1 : 0);
  }
  if ("tempInsuflamento" in patch) {
    const valor = Number(patch.tempInsuflamento);
    if (Number.isNaN(valor)) return { ok: false, status: 400, erro: "tempInsuflamento precisa ser numero" };
    sets.push("temp_insuflamento = ?");
    valores.push(valor);
  }
  if (!sets.length) {
    return { ok: false, status: 400, erro: "corpo vazio (esperado 'ligado' e/ou 'tempInsuflamento')" };
  }

  db.prepare(`UPDATE CLIMATIZADOR SET ${sets.join(", ")} WHERE id_climatizador = ?`).run(...valores, idClimatizador);

  return {
    ok: true,
    climatizador: db.prepare("SELECT * FROM CLIMATIZADOR WHERE id_climatizador = ?").get(idClimatizador),
  };
}

// ----- Alertas ---------------------------------------------------------
// Traduz ALERTA (colunas da DER) pro formato consumido pelo dashboard
// (docs/API_CONTRACT.md secao 1 "Alerta"): { id, level, tipo, mensagem, salaId, ts, reconhecido }.
// Necessario porque acknowledgeAlert/clearAcknowledged (ConfigContext.jsx) usam
// o retorno da chamada pra atualizar o estado de alertas direto (setAlerts(next)).
function paraAlertaFrontend(row) {
  return {
    id: row.id_alerta,
    level: row.nivel,
    tipo: row.tipo,
    mensagem: row.mensagem,
    salaId: row.id_sala,
    ts: row.data_hora,
    reconhecido: !!row.reconhecido,
  };
}

// GET /api/alertas
export function listarAlertas() {
  return db.prepare("SELECT * FROM ALERTA ORDER BY id_alerta DESC").all().map(paraAlertaFrontend);
}

// POST /api/alertas/:id/reconhecer
export function reconhecerAlerta(idAlerta) {
  const alerta = db.prepare("SELECT id_alerta FROM ALERTA WHERE id_alerta = ?").get(idAlerta);
  if (!alerta) return { ok: false, status: 404, erro: `alerta ${idAlerta} nao existe` };

  db.prepare("UPDATE ALERTA SET reconhecido = 1 WHERE id_alerta = ?").run(idAlerta);

  return { ok: true, alertas: listarAlertas() };
}

// DELETE /api/alertas/reconhecidos
export function limparReconhecidos() {
  db.prepare("DELETE FROM ALERTA WHERE reconhecido = 1").run();
  return { ok: true, alertas: listarAlertas() };
}
