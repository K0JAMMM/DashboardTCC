// ---------------------------------------------------------------------------
// Rotas de comando do HVAC: estado agregado, provisionamento de sala,
// VAV, setpoint e climatizador.
// IDOR: exigirPosseSala / podeComandarClimatizador garantem que o operador
// so comanda as salas atribuidas a ele.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "../banco/db.js";
import { validarIds } from "../middlewares/comuns.js";
import { exigirPosseSala, podeComandarClimatizador } from "../seguranca/auth.js";
import {
  vavAberturaSchema,
  vavModoSchema,
  vavFalhaSchema,
  setpointSchema,
  climatizadorPatchSchema,
  salaCompletaSchema,
} from "../seguranca/validacao.js";
import { montarEstado } from "../servicos/estado.js";
import { criarSalaCompleta } from "../servicos/provisionamento.js";
import { setVavAbertura, setVavModo, setVavFalha, setSalaSetpoint, setClimatizador } from "../servicos/acoes.js";

// Converte o retorno {ok, status, erro, ...} das acoes em resposta HTTP.
const responder = (res, resultado, campo) =>
  resultado.ok ? res.json(resultado[campo]) : res.status(resultado.status).json({ erro: resultado.erro });

export function rotasSalas({ config, exigir }) {
  const r = validarIds(Router());

  // Estado agregado que o dashboard React consome (docs/API_CONTRACT.md).
  r.get("/estado", (_req, res) => res.json(montarEstado()));

  // Cria SALA + VAV + SENSORES + LIMITES numa transacao (so admin).
  r.post("/salas/completa", exigir("admin"), (req, res) => {
    const resultado = criarSalaCompleta(salaCompletaSchema.parse(req.body));
    res.status(resultado.ok ? 201 : 400).json(resultado);
  });

  r.put("/salas/:salaId/vav", exigirPosseSala, (req, res) => {
    const { abertura } = vavAberturaSchema.parse(req.body);
    responder(res, setVavAbertura(req.params.salaId, abertura), "vav");
  });

  r.put("/salas/:salaId/vav/modo", exigirPosseSala, (req, res) => {
    const { modo } = vavModoSchema.parse(req.body);
    responder(res, setVavModo(req.params.salaId, modo), "vav");
  });

  // (demo) simular falha: so admin e so fora de producao.
  if (!config.producao) {
    r.put("/salas/:salaId/vav/falha", exigir("admin"), exigirPosseSala, (req, res) => {
      const { falha } = vavFalhaSchema.parse(req.body);
      responder(res, setVavFalha(req.params.salaId, falha), "vav");
    });
  }

  r.put("/salas/:salaId/setpoint", exigirPosseSala, (req, res) => {
    const { setpoint } = setpointSchema.parse(req.body);
    responder(res, setSalaSetpoint(req.params.salaId, setpoint), "sala");
  });

  r.put("/climatizadores/:id", (req, res) => {
    const patch = climatizadorPatchSchema.parse(req.body);
    const existe = db.prepare("SELECT 1 FROM CLIMATIZADOR WHERE id_climatizador = ?").get(req.params.id);
    if (!existe) return res.status(404).json({ erro: "climatizador nao encontrado" });
    if (!podeComandarClimatizador(req.usuario, req.params.id)) {
      return res.status(403).json({ erro: "sem acesso a este climatizador" });
    }
    responder(res, setClimatizador(req.params.id, patch), "climatizador");
  });

  return r;
}
