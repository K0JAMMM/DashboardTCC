// ===========================================================================
// TESTES DE SEGURANCA 2/4 - CRIPTOGRAFIA E SENHAS
//
// Verifica: senha nunca em texto puro (scrypt + salt), comparacao em tempo
// constante, politica de senha forte, hash nunca exposto pela API, JWT
// resistente a adulteracao (alg:none, chave errada, payload alterado,
// expirado), segredo obrigatorio e forte, tokens de dispositivo com hash.
// ===========================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { iniciarApi, db, usuarios, carregarConfig, SENHAS, JWT_SECRET_TESTE, arquivosDoBackend } from "./helpers.js";
import { hashSenha, verificarSenha, validarPoliticaSenha, hashToken } from "../src/seguranca/senha.js";

let api, tkAdmin;
before(async () => {
  api = await iniciarApi();
  tkAdmin = await api.login("admin");
});
after(() => api?.fechar());

const base64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("Senhas - armazenamento com hash (scrypt + salt)", () => {
  test("a senha NAO e salva em texto puro no banco", () => {
    const { senha_hash } = db.prepare("SELECT senha_hash FROM USUARIO WHERE login = 'operador1'").get();
    assert.ok(!senha_hash.includes(SENHAS.operador1), "hash contem a senha em claro");
    assert.match(senha_hash, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  test("nenhum usuario do banco tem senha legivel", () => {
    const todos = db.prepare("SELECT login, senha_hash FROM USUARIO").all();
    for (const u of todos) {
      for (const s of Object.values(SENHAS)) assert.ok(!u.senha_hash.includes(s), `${u.login} vazou senha`);
    }
  });

  test("mesma senha gera hashes diferentes (salt aleatorio => sem rainbow table)", async () => {
    const a = await hashSenha("Mesma-Senha-123!");
    const b = await hashSenha("Mesma-Senha-123!");
    assert.notEqual(a, b);
    assert.ok(await verificarSenha("Mesma-Senha-123!", a));
    assert.ok(await verificarSenha("Mesma-Senha-123!", b));
  });

  test("senha errada, hash adulterado ou formato invalido => false", async () => {
    const h = await hashSenha("Correta-Senha-123!");
    assert.equal(await verificarSenha("correta-senha-123!", h), false);
    const adulterado = h.slice(0, -2) + (h.endsWith("00") ? "11" : "00");
    assert.equal(await verificarSenha("Correta-Senha-123!", adulterado), false);
    assert.equal(await verificarSenha("x", "md5$abc"), false);
    assert.equal(await verificarSenha("x", null), false);
  });

  test("hash usa KDF lenta (dificulta forca bruta offline): >= 5 ms por tentativa", async () => {
    const h = await hashSenha("Medir-Tempo-123!");
    const t0 = performance.now();
    await verificarSenha("errada", h);
    assert.ok(performance.now() - t0 >= 5, "hash rapido demais (parece MD5/SHA puro)");
  });

  test("codigo usa comparacao em tempo constante (timingSafeEqual)", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "seguranca", "senha.js"), "utf8");
    assert.match(src, /timingSafeEqual/);
    assert.doesNotMatch(src, /createHash\(["'](md5|sha1)["']\)/i);
  });
});

describe("Senhas - politica de senha forte", () => {
  for (const [senha, motivo] of [
    ["123456", "curta e so numeros"],
    ["senhasemnumero", "sem maiuscula/numero/simbolo"],
    ["Curta1!", "menos de 12 caracteres"],
    ["SemSimbolo12345", "sem simbolo"],
    ["Senha@123456", "lista de senhas comuns"],
    ["novousuario-Aa1!", "contem o login"],
  ]) {
    test(`rejeita "${senha}" (${motivo}) => 400`, async () => {
      const r = await api.req("/api/usuarios", {
        method: "POST",
        token: tkAdmin,
        body: { login: "novousuario", senha, papel: "viewer" },
      });
      assert.equal(r.status, 400);
      assert.equal(usuarios.buscarUsuarioPorLogin("novousuario"), undefined);
    });
  }

  test("aceita senha forte => 201", async () => {
    const r = await api.req("/api/usuarios", {
      method: "POST",
      token: tkAdmin,
      body: { login: "tecnico", senha: "Ar-Condicionado#2026", papel: "viewer" },
    });
    assert.equal(r.status, 201);
  });

  test("validarPoliticaSenha lista todos os problemas", () => {
    assert.deepEqual(validarPoliticaSenha("Boa-Senha-Forte-9"), []);
    assert.ok(validarPoliticaSenha("abc").length >= 3);
  });
});

describe("Senhas - o hash nunca sai pela API", () => {
  test("login, /me e listagem de usuarios nao devolvem senha_hash", async () => {
    const respostas = [
      await api.req("/api/login", { method: "POST", body: { login: "admin", senha: SENHAS.admin } }),
      await api.req("/api/usuarios/me", { token: tkAdmin }),
      await api.req("/api/usuarios", { token: tkAdmin }),
      await api.req(`/api/usuarios/${api.contas.operador1.id}`, { token: tkAdmin }),
    ];
    for (const r of respostas) {
      assert.equal(r.status, 200);
      assert.ok(!/senha_hash|scrypt\$/.test(r.texto), `vazou hash em: ${r.texto.slice(0, 80)}`);
    }
  });

  test("mesma mensagem para usuario inexistente e senha errada (sem enumeracao de usuarios)", async () => {
    const a = await api.req("/api/login", { method: "POST", body: { login: "naoexiste", senha: "Qualquer-123!" } });
    const b = await api.req("/api/login", { method: "POST", body: { login: "viewer", senha: "Errada-Senha-123!" } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  test("tempo de resposta parecido para usuario inexistente (hash falso tambem e calculado)", async () => {
    const medir = async (login) => {
      const t0 = performance.now();
      await api.req("/api/login", { method: "POST", body: { login, senha: "Errada-Senha-123!" } });
      return performance.now() - t0;
    };
    let inexistente = 0;
    let existente = 0;
    for (let i = 0; i < 3; i++) {
      inexistente += await medir(`fantasma${i}`);
      existente += await medir("operador2");
    }
    assert.ok(inexistente > existente * 0.3, `inexistente ${inexistente}ms vs existente ${existente}ms`);
  });

  test("troca de senha exige a senha atual; a antiga deixa de funcionar", async () => {
    const token = await api.login("tecnico", "Ar-Condicionado#2026");
    const id = usuarios.buscarUsuarioPorLogin("tecnico").id_usuario;
    const errada = await api.req(`/api/usuarios/${id}/senha`, {
      method: "PUT",
      token,
      body: { senhaAtual: "chute", novaSenha: "Nova-Senha-Segura-77" },
    });
    assert.equal(errada.status, 401);
    const ok = await api.req(`/api/usuarios/${id}/senha`, {
      method: "PUT",
      token,
      body: { senhaAtual: "Ar-Condicionado#2026", novaSenha: "Nova-Senha-Segura-77" },
    });
    assert.equal(ok.status, 204);
    const antiga = await api.req("/api/login", { method: "POST", body: { login: "tecnico", senha: "Ar-Condicionado#2026" } });
    assert.equal(antiga.status, 401);
    assert.ok(await api.login("tecnico", "Nova-Senha-Segura-77"));
  });
});

describe("Criptografia - token JWT", () => {
  test("token valido e assinado com HS256", async () => {
    const [cab] = tkAdmin.split(".");
    assert.equal(JSON.parse(Buffer.from(cab, "base64url")).alg, "HS256");
    assert.equal((await api.req("/api/estado", { token: tkAdmin })).status, 200);
  });

  test("payload do token nao carrega senha nem hash", () => {
    const payload = JSON.parse(Buffer.from(tkAdmin.split(".")[1], "base64url"));
    assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "papel", "sub"]);
  });

  test('token com alg:"none" (sem assinatura) => 401', async () => {
    const forjado = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: String(api.contas.admin.id), papel: "admin" })}.`;
    assert.equal((await api.req("/api/usuarios", { token: forjado })).status, 401);
  });

  test("token assinado com outra chave => 401", async () => {
    const forjado = jwt.sign({ sub: String(api.contas.admin.id), papel: "admin" }, "chave-do-atacante-".repeat(3));
    assert.equal((await api.req("/api/usuarios", { token: forjado })).status, 401);
  });

  test("payload adulterado (viewer vira admin) mantendo a assinatura original => 401", async () => {
    const tkViewer = await api.login("viewer");
    const [cab, , ass] = tkViewer.split(".");
    const corpo = base64url({ sub: String(api.contas.admin.id), papel: "admin", iat: 1, exp: 9999999999 });
    assert.equal((await api.req("/api/usuarios", { token: `${cab}.${corpo}.${ass}` })).status, 401);
  });

  test("token expirado => 401", async () => {
    const expirado = jwt.sign({ sub: String(api.contas.admin.id), papel: "admin", exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET_TESTE);
    assert.equal((await api.req("/api/estado", { token: expirado })).status, 401);
  });

  test("papel vem do BANCO: token valido dizendo 'admin' para um viewer nao da poder de admin", async () => {
    const mentiroso = jwt.sign({ sub: String(api.contas.viewer.id), papel: "admin" }, JWT_SECRET_TESTE, { algorithm: "HS256" });
    assert.equal((await api.req("/api/usuarios", { token: mentiroso })).status, 403);
  });
});

describe("Criptografia - segredos e configuracao", () => {
  test("backend recusa subir sem JWT_SECRET", () => {
    assert.throws(() => carregarConfig({}), /JWT_SECRET/);
  });

  test("backend recusa JWT_SECRET curto ou padrao", () => {
    assert.throws(() => carregarConfig({ JWT_SECRET: "secret" }), /JWT_SECRET/);
    assert.throws(() => carregarConfig({ JWT_SECRET: "a".repeat(31) }), /JWT_SECRET/);
  });

  test("aceita segredo forte (>= 32 caracteres aleatorios)", () => {
    assert.doesNotThrow(() => carregarConfig({ JWT_SECRET: crypto.randomBytes(48).toString("hex") }));
  });

  test("nenhum segredo/senha fixo no codigo-fonte do backend", () => {
    const arquivos = arquivosDoBackend();
    assert.ok(arquivos.length >= 15, "varredura nao encontrou os arquivos do backend");
    for (const f of arquivos) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /jwtSecret\s*[:=]\s*["'`]/, `${f}: segredo JWT fixo`);
      // (placeholders de documentacao como "<sua senha forte>" sao ignorados)
      assert.doesNotMatch(src, /(senha|password)\s*[:=]\s*["'`](?!<)[^"'`]{4,}["'`]/i, `${f}: senha fixa`);
    }
  });

  test("token de dispositivo: 256 bits aleatorios e so o SHA-256 vai para o banco", () => {
    const a = usuarios.criarDispositivo({ nome: "ESP A", idSala: 1 });
    const b = usuarios.criarDispositivo({ nome: "ESP B", idSala: 1 });
    assert.match(a.token, /^[0-9a-f]{64}$/);
    assert.notEqual(a.token, b.token);
    const row = db.prepare("SELECT token_hash FROM DISPOSITIVO WHERE id_dispositivo = ?").get(a.dispositivo.id);
    assert.notEqual(row.token_hash, a.token);
    assert.equal(row.token_hash, hashToken(a.token));
    assert.equal(db.prepare("SELECT COUNT(*) c FROM DISPOSITIVO WHERE token_hash = ?").get(a.token).c, 0);
  });

  test("resposta forca HTTPS no navegador (HSTS) e nao expoe X-Powered-By", async () => {
    const r = await api.req("/api/health");
    assert.match(r.headers.get("strict-transport-security") || "", /max-age=\d+/);
    assert.equal(r.headers.get("x-powered-by"), null);
  });
});
