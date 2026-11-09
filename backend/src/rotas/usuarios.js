// ---------------------------------------------------------------------------
// Rotas de USUARIOS e DISPOSITIVOS (todas exigem login).
// IDOR: perfil/senha de outro usuario => 404 (nao revela que o id existe).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { assincrono, validarIds } from "../middlewares/comuns.js";
import { verificarSenha } from "../seguranca/senha.js";
import { novoUsuarioSchema, trocarSenhaSchema, dispositivoSchema } from "../seguranca/validacao.js";
import {
  buscarUsuarioPorId,
  listarUsuarios,
  paraUsuarioPublico,
  criarUsuario,
  trocarSenha,
  criarDispositivo,
} from "../servicos/usuarios.js";

// Troca de senha: o proprio usuario (confirmando a senha atual) ou admin.
// Fica separada porque e registrada ANTES do filtro "escrita exige operator"
// (ver app.js): o viewer tambem pode trocar a propria senha.
export function rotasConta() {
  const r = validarIds(Router());

  r.put(
    "/usuarios/:id/senha",
    assincrono(async (req, res) => {
      const id = Number(req.params.id);
      const { senhaAtual, novaSenha } = trocarSenhaSchema.parse(req.body);
      const ehAdmin = req.usuario.papel === "admin";
      if (!ehAdmin && req.usuario.id !== id) return res.status(404).json({ erro: "nao encontrado" });
      if (!ehAdmin || req.usuario.id === id) {
        const u = buscarUsuarioPorId(id);
        if (!(await verificarSenha(senhaAtual ?? "", u.senha_hash))) {
          return res.status(401).json({ erro: "senha atual incorreta" });
        }
      }
      const resultado = await trocarSenha(id, novaSenha);
      if (!resultado.ok) return res.status(resultado.status).json({ erro: resultado.erro, detalhes: resultado.detalhes });
      res.status(204).end();
    })
  );

  return r;
}

export function rotasUsuarios({ exigir }) {
  const r = validarIds(Router());

  r.get("/usuarios/me", (req, res) => res.json(paraUsuarioPublico(buscarUsuarioPorId(req.usuario.id))));

  r.get("/usuarios", exigir("admin"), (_req, res) => res.json(listarUsuarios()));

  // IDOR: so o proprio usuario ou admin.
  r.get("/usuarios/:id", (req, res) => {
    const id = Number(req.params.id);
    if (req.usuario.papel !== "admin" && req.usuario.id !== id) return res.status(404).json({ erro: "nao encontrado" });
    const u = buscarUsuarioPorId(id);
    return u ? res.json(paraUsuarioPublico(u)) : res.status(404).json({ erro: "nao encontrado" });
  });

  r.post(
    "/usuarios",
    exigir("admin"),
    assincrono(async (req, res) => {
      const resultado = await criarUsuario(novoUsuarioSchema.parse(req.body));
      if (!resultado.ok) return res.status(resultado.status).json({ erro: resultado.erro, detalhes: resultado.detalhes });
      res.status(201).json(resultado.usuario);
    })
  );

  // Cadastro de ESP32: o token aparece uma unica vez (no banco fica so o hash).
  r.post("/dispositivos", exigir("admin"), (req, res) => {
    const resultado = criarDispositivo(dispositivoSchema.parse(req.body));
    if (!resultado.ok) return res.status(resultado.status).json({ erro: resultado.erro });
    res.status(201).json({ ...resultado.dispositivo, token: resultado.token });
  });

  return r;
}
