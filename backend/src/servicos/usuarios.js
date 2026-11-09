// ---------------------------------------------------------------------------
// Acesso a dados de USUARIO / USUARIO_SALA / DISPOSITIVO.
// Todas as consultas usam parametros (?) - nunca concatenacao de entrada.
// ---------------------------------------------------------------------------

import { db } from "../banco/db.js";
import { hashSenha, validarPoliticaSenha, gerarTokenDispositivo, hashToken } from "../seguranca/senha.js";

// Campos publicos: senha_hash e contadores de bloqueio NUNCA saem pela API.
export function paraUsuarioPublico(u) {
  if (!u) return null;
  return { id: u.id_usuario, login: u.login, papel: u.papel, salas: salasDoUsuario(u.id_usuario) };
}

export function buscarUsuarioPorLogin(login) {
  return db.prepare("SELECT * FROM USUARIO WHERE login = ?").get(login);
}

export function buscarUsuarioPorId(id) {
  return db.prepare("SELECT * FROM USUARIO WHERE id_usuario = ?").get(id);
}

export function listarUsuarios() {
  return db.prepare("SELECT * FROM USUARIO ORDER BY id_usuario").all().map(paraUsuarioPublico);
}

export function salasDoUsuario(idUsuario) {
  return db
    .prepare("SELECT id_sala FROM USUARIO_SALA WHERE id_usuario = ? ORDER BY id_sala")
    .all(idUsuario)
    .map((r) => r.id_sala);
}

export async function criarUsuario({ login, senha, papel, salas = [] }) {
  const erros = validarPoliticaSenha(senha, login);
  if (erros.length) return { ok: false, status: 400, erro: "senha fraca", detalhes: erros };
  if (buscarUsuarioPorLogin(login)) return { ok: false, status: 409, erro: "login ja existe" };

  for (const idSala of salas) {
    if (!db.prepare("SELECT 1 FROM SALA WHERE id_sala = ?").get(idSala)) {
      return { ok: false, status: 400, erro: `sala ${idSala} nao existe` };
    }
  }

  const senhaHash = await hashSenha(senha);
  const tx = db.transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO USUARIO (login, senha_hash, papel) VALUES (?, ?, ?)").run(login, senhaHash, papel)
        .lastInsertRowid
    );
    const ins = db.prepare("INSERT INTO USUARIO_SALA (id_usuario, id_sala) VALUES (?, ?)");
    for (const idSala of salas) ins.run(id, idSala);
    return id;
  });
  const id = tx();
  return { ok: true, usuario: paraUsuarioPublico(buscarUsuarioPorId(id)) };
}

export async function trocarSenha(idUsuario, novaSenha) {
  const u = buscarUsuarioPorId(idUsuario);
  if (!u) return { ok: false, status: 404, erro: "nao encontrado" };
  const erros = validarPoliticaSenha(novaSenha, u.login);
  if (erros.length) return { ok: false, status: 400, erro: "senha fraca", detalhes: erros };
  db.prepare("UPDATE USUARIO SET senha_hash = ?, falhas_login = 0, bloqueado_ate = NULL WHERE id_usuario = ?").run(
    await hashSenha(novaSenha),
    idUsuario
  );
  return { ok: true };
}

// ----- Bloqueio de conta (anti forca bruta distribuida / credential stuffing)
export function contaBloqueada(u, agora = Date.now()) {
  return !!(u?.bloqueado_ate && Date.parse(u.bloqueado_ate) > agora);
}

export function registrarFalhaLogin(u, { maxFalhas, duracaoMs }) {
  const falhas = (u.falhas_login || 0) + 1;
  const bloqueia = falhas >= maxFalhas;
  db.prepare("UPDATE USUARIO SET falhas_login = ?, bloqueado_ate = ? WHERE id_usuario = ?").run(
    bloqueia ? 0 : falhas,
    bloqueia ? new Date(Date.now() + duracaoMs).toISOString() : u.bloqueado_ate ?? null,
    u.id_usuario
  );
  return bloqueia;
}

export function registrarSucessoLogin(u) {
  db.prepare("UPDATE USUARIO SET falhas_login = 0, bloqueado_ate = NULL WHERE id_usuario = ?").run(u.id_usuario);
}

// ----- Dispositivos -------------------------------------------------------
export function criarDispositivo({ nome, idSala }) {
  if (!db.prepare("SELECT 1 FROM SALA WHERE id_sala = ?").get(idSala)) {
    return { ok: false, status: 400, erro: `sala ${idSala} nao existe` };
  }
  const token = gerarTokenDispositivo();
  const id = Number(
    db.prepare("INSERT INTO DISPOSITIVO (nome, token_hash, id_sala) VALUES (?, ?, ?)").run(nome, hashToken(token), idSala)
      .lastInsertRowid
  );
  // O token em texto puro so e devolvido AGORA (para gravar no firmware).
  return { ok: true, dispositivo: { id, nome, idSala }, token };
}

export function buscarDispositivoPorToken(token) {
  if (!token) return null;
  return db.prepare("SELECT * FROM DISPOSITIVO WHERE token_hash = ?").get(hashToken(token));
}
