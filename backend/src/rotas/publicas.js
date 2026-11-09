// ---------------------------------------------------------------------------
// Rotas PUBLICAS (sem token): healthcheck e login.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Router } from "express";
import { assincrono } from "../middlewares/comuns.js";
import { hashSenha, verificarSenha } from "../seguranca/senha.js";
import { loginSchema } from "../seguranca/validacao.js";
import {
  buscarUsuarioPorLogin,
  paraUsuarioPublico,
  contaBloqueada,
  registrarFalhaLogin,
  registrarSucessoLogin,
} from "../servicos/usuarios.js";

// Hash de uma senha aleatoria: usado quando o login nao existe, para o tempo
// de resposta ser o mesmo (nao revela quais logins existem).
const HASH_FALSO = await hashSenha(crypto.randomUUID());

export function rotasPublicas({ config, limitadores, emitirToken }) {
  const r = Router();

  r.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  // POST /api/login { login, senha, website? }
  r.post(
    "/login",
    limitadores.login, // BOTS: tentativas por IP
    assincrono(async (req, res) => {
      const { login, senha, website } = loginSchema.parse(req.body);

      // BOTS - honeypot: campo escondido no formulario. Humano nao preenche; bot preenche.
      if (website) return res.status(400).json({ erro: "requisicao invalida" });

      const u = buscarUsuarioPorLogin(login);
      // BOTS - bloqueio de conta apos varias senhas erradas seguidas.
      if (u && contaBloqueada(u)) {
        return res.status(423).json({ erro: "conta temporariamente bloqueada por excesso de tentativas" });
      }
      const ok = await verificarSenha(senha, u?.senha_hash ?? HASH_FALSO);
      if (!u || !ok) {
        if (u) registrarFalhaLogin(u, config.bloqueio);
        return res.status(401).json({ erro: "credenciais invalidas" }); // mesma msg p/ usuario inexistente
      }
      registrarSucessoLogin(u);
      res.json({ token: emitirToken(u), usuario: paraUsuarioPublico(u) });
    })
  );

  return r;
}
