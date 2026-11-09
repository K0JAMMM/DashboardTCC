// ---------------------------------------------------------------------------
// Rotas de ALERTAS.
// IDOR: so reconhece/arquiva alertas das salas do usuario; quem reconheceu
// vem do TOKEN (nunca do corpo da requisicao).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { validarIds } from "../middlewares/comuns.js";
import { podeComandarSala, salaDoAlerta } from "../seguranca/auth.js";
import { listarAlertas, reconhecerAlerta, limparReconhecidos } from "../servicos/acoes.js";
import { salasDoUsuario } from "../servicos/usuarios.js";

export function rotasAlertas() {
  const r = validarIds(Router());

  r.get("/alertas", (_req, res) => res.json(listarAlertas()));

  // Arquiva (nao apaga) os reconhecidos. Registrada antes de /alertas/:id.
  r.delete("/alertas/reconhecidos", (req, res) => {
    const salas = req.usuario.papel === "admin" ? null : salasDoUsuario(req.usuario.id);
    res.json(limparReconhecidos(salas).alertas);
  });

  r.post("/alertas/:id/reconhecer", (req, res) => {
    const idSala = salaDoAlerta(req.params.id);
    if (idSala === undefined) return res.status(404).json({ erro: "alerta nao encontrado" });
    if (!podeComandarSala(req.usuario, idSala)) return res.status(403).json({ erro: "sem acesso a esta sala" });
    const resultado = reconhecerAlerta(req.params.id, req.usuario.id);
    if (!resultado.ok) return res.status(resultado.status).json({ erro: resultado.erro });
    res.json(resultado.alertas);
  });

  return r;
}
