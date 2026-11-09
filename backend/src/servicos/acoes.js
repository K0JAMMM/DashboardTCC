// ---------------------------------------------------------------------------
// Camada de ACOES (framework, parte 1 - camadas).
//
// Problema que resolve: o dashboard React (modo VITE_API_MODE=real) chama
// rotas dedicadas com payload em camelCase (docs/API_CONTRACT.md secao 2,
// src/api/client.js) que nao batem 1:1 com os nomes de coluna da DER
// (ex.: "tempInsuflamento" -> CLIMATIZADOR.temp_insuflamento). O crud()
// generico (src/rotas/crud.js) so aceita o nome exato da coluna no corpo, entao
// essas acoes de escrita so funcionavam em modo mock. Este arquivo traduz o
// payload do frontend pros nomes de coluna certos e valida a entidade
// referenciada antes de gravar.
// ---------------------------------------------------------------------------

import { db } from "../banco/db.js";
import { LIMITES } from "../seguranca/validacao.js";

function salaExiste(idSala) {
  return db.prepare("SELECT id_sala FROM SALA WHERE id_sala = ?").get(idSala);
}

// PUT /api/salas/:salaId/vav  { abertura } -- override manual (forca modo:manual)
export function setVavAbertura(idSala, abertura) {
  if (!salaExiste(idSala)) return { ok: false, status: 404, erro: `sala ${idSala} nao existe` };
  const valor = Number(abertura);
  if (!Number.isFinite(valor)) return { ok: false, status: 400, erro: "abertura precisa ser numero finito" };

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
  if (!Number.isFinite(valor)) return { ok: false, status: 400, erro: "setpoint precisa ser numero finito" };

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
    if (!Number.isFinite(valor) || valor < LIMITES.insuflamento[0] || valor > LIMITES.insuflamento[1]) {
      return { ok: false, status: 400, erro: `tempInsuflamento deve estar entre ${LIMITES.insuflamento[0]} e ${LIMITES.insuflamento[1]}` };
    }
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

// GET /api/alertas  (alertas arquivados nao aparecem, mas continuam no banco)
export function listarAlertas() {
  return db
    .prepare("SELECT * FROM ALERTA WHERE COALESCE(arquivado, 0) = 0 ORDER BY id_alerta DESC")
    .all()
    .map(paraAlertaFrontend);
}

// POST /api/alertas/:id/reconhecer -- registra QUEM (id do usuario do token,
// nunca do corpo da requisicao) e QUANDO reconheceu.
export function reconhecerAlerta(idAlerta, idUsuario) {
  const alerta = db.prepare("SELECT id_alerta FROM ALERTA WHERE id_alerta = ?").get(idAlerta);
  if (!alerta) return { ok: false, status: 404, erro: `alerta ${idAlerta} nao existe` };

  db.prepare("UPDATE ALERTA SET reconhecido = 1, reconhecido_por = ?, reconhecido_em = ? WHERE id_alerta = ?").run(
    idUsuario ?? null,
    new Date().toISOString(),
    idAlerta
  );

  return { ok: true, alertas: listarAlertas() };
}

// DELETE /api/alertas/reconhecidos -- antes apagava a trilha de auditoria;
// agora ARQUIVA. salasPermitidas = null (admin) => todas as salas.
export function limparReconhecidos(salasPermitidas = null) {
  if (salasPermitidas === null) {
    db.prepare("UPDATE ALERTA SET arquivado = 1 WHERE reconhecido = 1").run();
  } else if (salasPermitidas.length) {
    const marcadores = salasPermitidas.map(() => "?").join(", ");
    db.prepare(`UPDATE ALERTA SET arquivado = 1 WHERE reconhecido = 1 AND id_sala IN (${marcadores})`).run(
      ...salasPermitidas
    );
  }
  return { ok: true, alertas: listarAlertas() };
}
