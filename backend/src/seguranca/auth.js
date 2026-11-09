// ---------------------------------------------------------------------------
// Autenticacao (JWT) e autorizacao (papel + posse por sala).
//
// Anti-IDOR: nao basta estar logado. Toda rota que recebe um ID de sala,
// alerta, climatizador ou usuario confere se ESSE usuario tem direito sobre
// ESSE objeto (podeAcessarSala / donoOuAdmin). Trocar o numero na URL nao
// da acesso a recurso de outra pessoa.
// ---------------------------------------------------------------------------

import jwt from "jsonwebtoken";
import { db } from "../banco/db.js";
import { buscarUsuarioPorId, salasDoUsuario, buscarDispositivoPorToken } from "../servicos/usuarios.js";

const NIVEL = { viewer: 1, operator: 2, admin: 3 };

export function criarAuth(config) {
  function emitirToken(u) {
    return jwt.sign({ sub: String(u.id_usuario), papel: u.papel }, config.jwtSecret, {
      algorithm: "HS256",
      expiresIn: config.jwtExpiraEm,
    });
  }

  // Valida o Bearer token. O algoritmo e FIXO em HS256: tokens "alg:none" ou
  // assinados com outra chave sao rejeitados. O papel vem do BANCO (nao do
  // token), entao rebaixar/remover um usuario vale na hora.
  function autenticar(req, res, next) {
    const m = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)$/.exec(req.get("authorization") || "");
    if (!m) return res.status(401).json({ erro: "nao autenticado" });
    let payload;
    try {
      payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ erro: "token invalido ou expirado" });
    }
    const u = buscarUsuarioPorId(Number(payload.sub));
    if (!u) return res.status(401).json({ erro: "token invalido ou expirado" });
    req.usuario = { id: u.id_usuario, login: u.login, papel: u.papel };
    next();
  }

  const exigir = (minimo) => (req, res, next) =>
    NIVEL[req.usuario?.papel] >= NIVEL[minimo] ? next() : res.status(403).json({ erro: "sem permissao" });

  // ESP32: cabecalho X-Device-Token. No banco so existe o hash do token.
  function autenticarDispositivo(req, res, next) {
    const disp = buscarDispositivoPorToken(req.get("x-device-token"));
    if (!disp) return res.status(401).json({ erro: "dispositivo nao autorizado" });
    req.dispositivo = disp;
    next();
  }

  return { emitirToken, autenticar, exigir, autenticarDispositivo };
}

// ----- Checagens de posse (object-level authorization) ---------------------

// admin: todas as salas. operator: so as atribuidas em USUARIO_SALA. viewer: nenhuma (so le).
export function podeComandarSala(usuario, idSala) {
  if (usuario.papel === "admin") return true;
  if (usuario.papel !== "operator") return false;
  return salasDoUsuario(usuario.id).includes(Number(idSala));
}

// Climatizador: o operador precisa ser responsavel por TODAS as salas atendidas
// por ele (desligar o climatizador afeta todas). Sem salas => so admin.
export function podeComandarClimatizador(usuario, idClimatizador) {
  if (usuario.papel === "admin") return true;
  if (usuario.papel !== "operator") return false;
  const salas = db.prepare("SELECT id_sala FROM SALA WHERE id_climatizador = ?").all(idClimatizador);
  if (!salas.length) return false;
  const minhas = salasDoUsuario(usuario.id);
  return salas.every((s) => minhas.includes(s.id_sala));
}

export function salaDoAlerta(idAlerta) {
  return db.prepare("SELECT id_sala FROM ALERTA WHERE id_alerta = ?").get(idAlerta)?.id_sala;
}

// Middleware: so passa se o usuario puder comandar a sala :salaId.
// Sala inexistente => 404; sala de outro operador => 403.
export function exigirPosseSala(req, res, next) {
  const idSala = Number(req.params.salaId);
  if (!db.prepare("SELECT 1 FROM SALA WHERE id_sala = ?").get(idSala)) {
    return res.status(404).json({ erro: "sala nao encontrada" });
  }
  if (!podeComandarSala(req.usuario, idSala)) {
    return res.status(403).json({ erro: "sem acesso a esta sala" });
  }
  next();
}
