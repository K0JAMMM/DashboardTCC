// ---------------------------------------------------------------------------
// CRUD generico das entidades da DER + consultas auxiliares.
//  - Leitura: qualquer usuario logado (paginada).
//  - Escrita: so admin e so com schema (allowlist) definido em validacao.js.
//    As colunas gravadas vem do SCHEMA, nunca das chaves enviadas pelo cliente
//    (anti injecao de nome de coluna e anti mass assignment).
//  - Sem DELETE: leituras e alertas sao trilha de auditoria.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "../banco/db.js";
import { validarIds } from "../middlewares/comuns.js";
import { crudSchemas } from "../seguranca/validacao.js";

// rota da API -> [tabela, chave primaria]
const ENTIDADES = {
  climatizadores: ["CLIMATIZADOR", "id_climatizador"],
  salas: ["SALA", "id_sala"],
  vavs: ["VAV", "id_vav"],
  sensores: ["SENSOR", "id_sensor"],
  limites: ["LIMITE_ALERTA", "id_limite"],
  alertas: ["ALERTA", "id_alerta"],
  leituras: ["LEITURA_SENSOR", "id_leitura"],
};

function registrarCrud(r, exigir, rota, tabela, pk) {
  const schemas = crudSchemas[tabela] || {};
  const buscar = (id) => db.prepare(`SELECT * FROM ${tabela} WHERE "${pk}" = ?`).get(id);

  r.get(`/${rota}`, (req, res) => {
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json(db.prepare(`SELECT * FROM ${tabela} ORDER BY "${pk}" DESC LIMIT ? OFFSET ?`).all(limite, offset));
  });

  r.get(`/${rota}/:id`, (req, res) => {
    const row = buscar(req.params.id);
    return row ? res.json(row) : res.status(404).json({ erro: "nao encontrado" });
  });

  if (schemas.criar) {
    r.post(`/${rota}`, exigir("admin"), (req, res) => {
      const dados = schemas.criar.parse(req.body);
      const cols = Object.keys(dados);
      const info = db
        .prepare(`INSERT INTO ${tabela} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .run(...cols.map((c) => dados[c]));
      res.status(201).json(buscar(info.lastInsertRowid));
    });
  }

  if (schemas.atualizar) {
    r.put(`/${rota}/:id`, exigir("admin"), (req, res) => {
      const dados = schemas.atualizar.parse(req.body);
      const cols = Object.keys(dados);
      if (!cols.length) return res.status(400).json({ erro: "corpo vazio" });
      if (!buscar(req.params.id)) return res.status(404).json({ erro: "nao encontrado" });
      db.prepare(`UPDATE ${tabela} SET ${cols.map((c) => `"${c}" = ?`).join(", ")} WHERE "${pk}" = ?`).run(
        ...cols.map((c) => dados[c]),
        req.params.id
      );
      res.json(buscar(req.params.id));
    });
  }
}

export function rotasCrud({ exigir }) {
  const r = validarIds(Router());

  for (const [rota, [tabela, pk]] of Object.entries(ENTIDADES)) registrarCrud(r, exigir, rota, tabela, pk);

  // Historico de um sensor
  r.get("/sensores/:id/leituras", (req, res) => {
    res.json(
      db.prepare("SELECT * FROM LEITURA_SENSOR WHERE id_sensor = ? ORDER BY id_leitura DESC LIMIT 500").all(req.params.id)
    );
  });

  // Sensores de uma sala
  r.get("/salas/:id/sensores", (req, res) => {
    res.json(db.prepare("SELECT * FROM SENSOR WHERE id_sala = ?").all(req.params.id));
  });

  return r;
}
