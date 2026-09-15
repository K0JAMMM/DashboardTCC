// ---------------------------------------------------------------------------
// API REST do backend HVAC (Express + SQLite conforme a DER).
// Expoe CRUD das 7 entidades da DER + ingestao de leituras + ponte MQTT + ntfy.
// ---------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { inserirLeitura } from "./logic.js";
import { startMqtt } from "./mqttBridge.js";
import { criarSalaCompleta } from "./provisioning.js";
import { montarEstado } from "./estado.js";
import {
  setVavAbertura,
  setVavModo,
  setVavFalha,
  setSalaSetpoint,
  setClimatizador,
  listarAlertas,
  reconhecerAlerta,
  limparReconhecidos,
} from "./acoes.js";

const app = express();
app.use(cors());
app.use(express.json());

// ----- Fabrica de CRUD generico e seguro (colunas via PRAGMA) --------------
function colunas(tabela) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
}

function crud(rota, tabela, pk) {
  const cols = colunas(tabela);
  const editaveis = cols.filter((c) => c !== pk); // nunca deixa alterar a PK

  // LISTAR
  app.get(`/api/${rota}`, (_req, res) => {
    res.json(db.prepare(`SELECT * FROM ${tabela}`).all());
  });

  // OBTER por id
  app.get(`/api/${rota}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${tabela} WHERE "${pk}" = ?`).get(req.params.id);
    return row ? res.json(row) : res.status(404).json({ erro: "nao encontrado" });
  });

  // CRIAR
  app.post(`/api/${rota}`, (req, res) => {
    const keys = editaveis.filter((k) => k in req.body);
    if (!keys.length) return res.status(400).json({ erro: "corpo vazio" });
    const sql = `INSERT INTO ${tabela} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
    const info = db.prepare(sql).run(...keys.map((k) => req.body[k]));
    res.status(201).json(db.prepare(`SELECT * FROM ${tabela} WHERE "${pk}" = ?`).get(info.lastInsertRowid));
  });

  // ATUALIZAR
  app.put(`/api/${rota}/:id`, (req, res) => {
    const keys = editaveis.filter((k) => k in req.body);
    if (!keys.length) return res.status(400).json({ erro: "corpo vazio" });
    const sql = `UPDATE ${tabela} SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE "${pk}" = ?`;
    db.prepare(sql).run(...keys.map((k) => req.body[k]), req.params.id);
    res.json(db.prepare(`SELECT * FROM ${tabela} WHERE "${pk}" = ?`).get(req.params.id));
  });

  // EXCLUIR
  app.delete(`/api/${rota}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${tabela} WHERE "${pk}" = ?`).run(req.params.id);
    res.status(204).end();
  });
}

// ----- Camada framework: provisionamento + agregacao + acoes ---------------
// (ver backend/provisioning.js, backend/estado.js e backend/acoes.js).
// Registradas antes do CRUD generico: a maioria nao colide (rotas com
// sufixo, ex. /api/salas/:salaId/vav), exceto PUT /api/climatizadores/:id e
// DELETE /api/alertas/reconhecidos, que substituem de proposito o handler
// generico correspondente (precisam traduzir camelCase -> coluna da DER, o
// que o crud() generico nao faz - ver acoes.js).

// Cria SALA + VAV + SENSORES + LIMITES em uma unica chamada/transacao.
// Body: { nome, andar?, idClimatizador, setpoint?, vav?, sensores? }
app.post("/api/salas/completa", (req, res) => {
  const r = criarSalaCompleta(req.body);
  res.status(r.ok ? 201 : 400).json(r);
});

// Estado agregado que o dashboard React consome (contrato de docs/API_CONTRACT.md).
app.get("/api/estado", (_req, res) => {
  res.json(montarEstado());
});

// Override manual da VAV. Body: { abertura: 0-100 }
app.put("/api/salas/:salaId/vav", (req, res) => {
  const r = setVavAbertura(req.params.salaId, req.body.abertura);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.vav);
});

// Modo de operacao da VAV. Body: { modo: "auto" | "manual" }
app.put("/api/salas/:salaId/vav/modo", (req, res) => {
  const r = setVavModo(req.params.salaId, req.body.modo);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.vav);
});

// (demo) forca/normaliza falha de VAV. Body: { falha: boolean }
app.put("/api/salas/:salaId/vav/falha", (req, res) => {
  const r = setVavFalha(req.params.salaId, req.body.falha);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.vav);
});

// Setpoint de temperatura da sala. Body: { setpoint: number }
app.put("/api/salas/:salaId/setpoint", (req, res) => {
  const r = setSalaSetpoint(req.params.salaId, req.body.setpoint);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.sala);
});

// Liga/desliga e/ou ajusta temp. de insuflamento do climatizador.
// Body: { ligado?: boolean, tempInsuflamento?: number }
app.put("/api/climatizadores/:id", (req, res) => {
  const r = setClimatizador(req.params.id, req.body);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.climatizador);
});

// Lista de alertas no formato do contrato (id, level, tipo, mensagem, salaId, ts, reconhecido).
app.get("/api/alertas", (_req, res) => {
  res.json(listarAlertas());
});

// Marca um alerta como reconhecido; retorna a lista atualizada (ConfigContext usa direto).
app.post("/api/alertas/:id/reconhecer", (req, res) => {
  const r = reconhecerAlerta(req.params.id);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });
  res.json(r.alertas);
});

// Remove alertas ja reconhecidos; retorna a lista atualizada.
app.delete("/api/alertas/reconhecidos", (_req, res) => {
  const r = limparReconhecidos();
  res.json(r.alertas);
});

// Uma rota por entidade da DER
crud("climatizadores", "CLIMATIZADOR", "id_climatizador");
crud("salas", "SALA", "id_sala");
crud("vavs", "VAV", "id_vav");
crud("sensores", "SENSOR", "id_sensor");
crud("limites", "LIMITE_ALERTA", "id_limite");
crud("alertas", "ALERTA", "id_alerta");
crud("leituras", "LEITURA_SENSOR", "id_leitura");

// ----- Rotas auxiliares ----------------------------------------------------

// Leituras de um sensor (historico)
app.get("/api/sensores/:id/leituras", (req, res) => {
  res.json(
    db.prepare("SELECT * FROM LEITURA_SENSOR WHERE id_sensor = ? ORDER BY id_leitura DESC LIMIT 500").all(req.params.id)
  );
});

// Sensores de uma sala
app.get("/api/salas/:id/sensores", (req, res) => {
  res.json(db.prepare("SELECT * FROM SENSOR WHERE id_sala = ?").all(req.params.id));
});

// Ingestao de leitura (ESP32 via REST OU teste manual):
// body: { id_sensor, valor, qualidade? } -> grava leitura e avalia limites/alertas
app.post("/api/telemetria", (req, res) => {
  const r = inserirLeitura(req.body);
  res.status(r.ok ? 201 : 400).json(r);
});

// Healthcheck
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend HVAC ouvindo em http://localhost:${PORT}`);
  startMqtt();
});
