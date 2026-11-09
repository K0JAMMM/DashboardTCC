// ===========================================================================
// TESTES DE SEGURANCA 4/4 - BOTS (automacao maliciosa)
//
// Forca bruta e credential stuffing no login, flood da API e da telemetria,
// troca de IP falsa via X-Forwarded-For, scanners automaticos (sqlmap,
// nikto...), honeypot no formulario de login e corpo gigante (DoS).
// Cada teste sobe uma instancia da API com limites pequenos para conseguir
// demonstrar o bloqueio em poucas requisicoes.
// ===========================================================================

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarApi, db, usuarios, sensorDa, SENHAS } from "./helpers.js";

const abertas = [];
async function api(opcoes) {
  const a = await iniciarApi(opcoes);
  abertas.push(a);
  return a;
}
after(() => Promise.all(abertas.map((a) => a.fechar())));

const loginBody = (login, senha) => ({ method: "POST", body: { login, senha } });
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const desbloquear = (login) =>
  db.prepare("UPDATE USUARIO SET falhas_login = 0, bloqueado_ate = NULL WHERE login = ?").run(login);

describe("Bots - forca bruta no login", () => {
  test("limite por IP: apos 3 tentativas, a 4a recebe 429 (mesmo com a senha certa)", async () => {
    const a = await api({ rateLimit: { maxLogin: 3 } });
    for (let i = 0; i < 3; i++) {
      assert.equal((await a.req("/api/login", loginBody("viewer", `Chute-${i}-Errado!`))).status, 401);
    }
    const r = await a.req("/api/login", loginBody("viewer", SENHAS.viewer));
    assert.equal(r.status, 429);
    assert.equal(r.body.token, undefined);
    assert.ok(r.headers.get("retry-after") || r.headers.get("ratelimit"), "sem cabecalho de rate limit");
    desbloquear("viewer");
  });

  test("bot trocando X-Forwarded-For a cada tentativa NAO escapa do limite", async () => {
    const a = await api({ rateLimit: { maxLogin: 3 } });
    const status = [];
    for (let i = 0; i < 6; i++) {
      const r = await a.req("/api/login", {
        ...loginBody("viewer", `Chute-${i}-Errado!`),
        headers: { "X-Forwarded-For": `203.0.113.${i + 1}`, "X-Real-IP": `198.51.100.${i + 1}` },
      });
      status.push(r.status);
    }
    assert.deepEqual(status.slice(3), [429, 429, 429]);
    desbloquear("viewer");
  });

  test("bloqueio de conta: 3 senhas erradas => conta bloqueada (423), mesmo com a senha certa", async () => {
    const a = await api({ bloqueio: { maxFalhas: 3, duracaoMs: 60_000 } });
    for (let i = 0; i < 3; i++) {
      assert.equal((await a.req("/api/login", loginBody("operador2", `Errada-${i}-Senha!`))).status, 401);
    }
    const r = await a.req("/api/login", loginBody("operador2", SENHAS.operador2));
    assert.equal(r.status, 423);
    assert.equal(r.body.token, undefined);
    assert.ok(usuarios.contaBloqueada(usuarios.buscarUsuarioPorLogin("operador2")));
    desbloquear("operador2");
  });

  test("bloqueio expira sozinho e o usuario legitimo volta a entrar", async () => {
    const a = await api({ bloqueio: { maxFalhas: 2, duracaoMs: 300 } });
    await a.req("/api/login", loginBody("operador2", "Errada-1-Senha!"));
    await a.req("/api/login", loginBody("operador2", "Errada-2-Senha!"));
    assert.equal((await a.req("/api/login", loginBody("operador2", SENHAS.operador2))).status, 423);
    await esperar(400);
    assert.equal((await a.req("/api/login", loginBody("operador2", SENHAS.operador2))).status, 200);
  });

  test("login correto zera o contador de falhas", async () => {
    const a = await api({ bloqueio: { maxFalhas: 3, duracaoMs: 60_000 } });
    await a.req("/api/login", loginBody("operador1", "Errada-1-Senha!"));
    await a.req("/api/login", loginBody("operador1", "Errada-2-Senha!"));
    assert.equal((await a.req("/api/login", loginBody("operador1", SENHAS.operador1))).status, 200);
    assert.equal(usuarios.buscarUsuarioPorLogin("operador1").falhas_login, 0);
  });

  test("credential stuffing: bot testa 25 senhas comuns no admin e nenhuma passa", async () => {
    const a = await api({ rateLimit: { maxLogin: 10 }, bloqueio: { maxFalhas: 5, duracaoMs: 60_000 } });
    const lista = ["123456", "admin", "admin123", "password", "senha123", "Senha@123", "qwerty", "hvac2026", "tcc123",
      "letmein", "welcome", "abc123", "iloveyou", "monkey", "dragon", "111111", "sunshine", "master", "root", "toor",
      "123123", "pass", "test", "guest", SENHAS.admin /* a certa, no fim */];
    const status = [];
    for (const senha of lista) status.push((await a.req("/api/login", loginBody("admin", senha))).status);
    assert.ok(!status.includes(200), "o bot conseguiu entrar");
    assert.ok(status.includes(423), "conta nao foi bloqueada");
    assert.ok(status.includes(429), "IP nao foi limitado");
    desbloquear("admin");
  });
});

describe("Bots - flood da API", () => {
  test("limite global: a 6a requisicao no minuto recebe 429", async () => {
    const a = await api({ rateLimit: { maxApi: 5 } });
    const status = [];
    for (let i = 0; i < 6; i++) status.push((await a.req("/api/health")).status);
    assert.deepEqual(status, [200, 200, 200, 200, 200, 429]);
  });

  test("rajada de 50 requisicoes simultaneas: so o limite passa", async () => {
    const a = await api({ rateLimit: { maxApi: 20 } });
    const res = await Promise.all(Array.from({ length: 50 }, () => a.req("/api/health")));
    const ok = res.filter((r) => r.status === 200).length;
    const bloq = res.filter((r) => r.status === 429).length;
    assert.equal(ok, 20);
    assert.equal(bloq, 30);
  });

  test("dispositivo inundando telemetria: 4a leitura => 429; outro dispositivo segue normal", async () => {
    const a = await api({ rateLimit: { maxTelemetria: 3 } });
    const esp1 = usuarios.criarDispositivo({ nome: "ESP flood", idSala: 1 }).token;
    const esp3 = usuarios.criarDispositivo({ nome: "ESP vizinho", idSala: 3 }).token;
    const enviar = (token, idSala) =>
      a.req("/api/telemetria", {
        method: "POST",
        headers: { "X-Device-Token": token },
        body: { id_sensor: sensorDa(idSala, "umidade"), valor: 50 },
      });
    const status = [];
    for (let i = 0; i < 4; i++) status.push((await enviar(esp1, 1)).status);
    assert.deepEqual(status, [201, 201, 201, 429]);
    assert.equal((await enviar(esp3, 3)).status, 201);
  });

  test("corpo gigante (> 20 KB) => 413 sem processar", async () => {
    const a = await api();
    const r = await a.req("/api/login", { method: "POST", body: { login: "admin", senha: "x".repeat(50_000) } });
    assert.equal(r.status, 413);
  });
});

describe("Bots - scanners e honeypot", () => {
  for (const [ferramenta, ua] of [
    ["sqlmap", "sqlmap/1.7.2#stable (https://sqlmap.org)"],
    ["Nikto", "Mozilla/5.00 (Nikto/2.5.0) (Evasions:None)"],
    ["Nmap", "Nmap Scripting Engine"],
    ["Nuclei", "Nuclei - Open-source project (github.com/projectdiscovery/nuclei)"],
    ["gobuster", "gobuster/3.6"],
  ]) {
    test(`User-Agent de scanner (${ferramenta}) => 403`, async () => {
      const a = await api();
      const r = await a.req("/api/health", { headers: { "User-Agent": ua } });
      assert.equal(r.status, 403);
    });
  }

  test("requisicao sem User-Agent => 403", async () => {
    const a = await api();
    const r = await a.req("/api/health", { headers: { "User-Agent": "" } });
    assert.equal(r.status, 403);
  });

  test("navegador comum e ESP32 passam normalmente", async () => {
    const a = await api();
    for (const ua of ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", "ESP32HTTPClient"]) {
      assert.equal((await a.req("/api/health", { headers: { "User-Agent": ua } })).status, 200);
    }
  });

  test("honeypot: bot preenche o campo invisivel 'website' => 400 e sem token, mesmo com a senha certa", async () => {
    const a = await api();
    const r = await a.req("/api/login", {
      method: "POST",
      body: { login: "viewer", senha: SENHAS.viewer, website: "http://spam.example" },
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.token, undefined);
  });

  test("humano (campo honeypot vazio) entra normalmente", async () => {
    const a = await api();
    const r = await a.req("/api/login", { method: "POST", body: { login: "viewer", senha: SENHAS.viewer, website: "" } });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
  });
});
