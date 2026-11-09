// ===========================================================================
// TESTES DE SEGURANCA 3/4 - INJECAO DE CODIGO
//
// SQL Injection (login, IDs na URL, query string, nomes de coluna no corpo),
// injecao de tipo/operador (estilo NoSQL), prototype pollution, XSS
// armazenado, injecao de formula em CSV, execucao de codigo (eval/exec) e
// vazamento de stack trace.
// ===========================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iniciarApi, db, usuarios, logic, sensorDa, SENHAS, arquivosDoBackend } from "./helpers.js";
import { escCsv } from "../../src/utils/csv.js";

let api, tk;
before(async () => {
  api = await iniciarApi();
  tk = { admin: await api.login("admin"), op1: await api.login("operador1") };
});
after(() => api?.fechar());

const tabelaIntacta = (t, minimo = 1) =>
  assert.ok(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c >= minimo, `tabela ${t} foi afetada`);

describe("Injecao SQL - login", () => {
  for (const login of ["admin' --", "' OR '1'='1", "admin'/*", "x' UNION SELECT 1,2,3,4,5,6,7 --"]) {
    test(`login = ${JSON.stringify(login)} nao autentica`, async () => {
      const r = await api.req("/api/login", { method: "POST", body: { login, senha: "qualquer" } });
      assert.ok([400, 401].includes(r.status), `status ${r.status}`);
      assert.equal(r.body?.token, undefined);
    });
  }

  test("senha = \"' OR '1'='1\" com login valido => 401", async () => {
    const r = await api.req("/api/login", { method: "POST", body: { login: "admin", senha: "' OR '1'='1" } });
    assert.equal(r.status, 401);
  });

  test("camada de dados e parametrizada: o payload e tratado como texto literal", () => {
    assert.equal(usuarios.buscarUsuarioPorLogin("' OR '1'='1"), undefined);
    assert.equal(usuarios.buscarUsuarioPorLogin("admin' --"), undefined);
    tabelaIntacta("USUARIO", 4);
  });
});

describe("Injecao SQL - IDs na URL e query string", () => {
  for (const rota of [
    "/api/salas/1 OR 1=1",
    "/api/salas/1;DROP TABLE SALA",
    "/api/salas/1' OR '1'='1",
    "/api/usuarios/2 OR 1=1",
    "/api/leituras/0 UNION SELECT * FROM USUARIO",
    "/api/salas/-1",
    "/api/salas/1e3",
  ]) {
    test(`GET ${rota} => 400 (id precisa ser inteiro positivo)`, async () => {
      const r = await api.req(encodeURI(rota), { token: tk.admin });
      assert.equal(r.status, 400);
    });
  }

  test("PUT /api/salas/1;DROP TABLE VAV/vav => 400 e tabelas intactas", async () => {
    const r = await api.req(encodeURI("/api/salas/1;DROP TABLE VAV/vav"), {
      method: "PUT",
      token: tk.admin,
      body: { abertura: 10 },
    });
    assert.ok([400, 404].includes(r.status));
    tabelaIntacta("VAV", 4);
    tabelaIntacta("SALA", 4);
  });

  test("?limit=1;DROP TABLE... e ?offset=UNION... sao convertidos para numero", async () => {
    const r1 = await api.req("/api/salas?limit=" + encodeURIComponent("1; DROP TABLE SALA; --"), { token: tk.admin });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.length, 1);
    const r2 = await api.req("/api/salas?offset=" + encodeURIComponent("0 UNION SELECT * FROM USUARIO"), { token: tk.admin });
    assert.equal(r2.status, 200);
    assert.ok(!/senha_hash|scrypt/.test(r2.texto));
    tabelaIntacta("SALA", 4);
  });
});

describe("Injecao SQL - corpo da requisicao", () => {
  test("nome de coluna malicioso como chave do JSON => 400", async () => {
    const r = await api.req("/api/salas/1", {
      method: "PUT",
      token: tk.admin,
      body: { 'nome" = (SELECT senha_hash FROM USUARIO LIMIT 1), "andar': "x" },
    });
    assert.equal(r.status, 400);
    assert.ok(!/scrypt/.test(db.prepare("SELECT nome FROM SALA WHERE id_sala = 1").get().nome));
  });

  test("valor com SQL no campo nome => 400 (caracteres fora da allowlist)", async () => {
    const r = await api.req("/api/salas/1", {
      method: "PUT",
      token: tk.admin,
      body: { nome: "Sala'); DROP TABLE SALA; --" },
    });
    assert.equal(r.status, 400);
    tabelaIntacta("SALA", 4);
  });

  test("provisionamento com SQL no nome => 400 e nenhuma sala criada", async () => {
    const antes = db.prepare("SELECT COUNT(*) c FROM SALA").get().c;
    const r = await api.req("/api/salas/completa", {
      method: "POST",
      token: tk.admin,
      body: { nome: "X'); DELETE FROM SENSOR; --", idClimatizador: 1 },
    });
    assert.equal(r.status, 400);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM SALA").get().c, antes);
    tabelaIntacta("SENSOR", 12);
  });
});

describe("Injecao de tipo / operador (estilo NoSQL)", () => {
  test('login com objeto {"$ne": null} => 400', async () => {
    const r = await api.req("/api/login", { method: "POST", body: { login: { $ne: null }, senha: { $ne: null } } });
    assert.equal(r.status, 400);
  });

  test("login com array => 400", async () => {
    const r = await api.req("/api/login", { method: "POST", body: { login: ["admin"], senha: [SENHAS.admin] } });
    assert.equal(r.status, 400);
  });

  test('setpoint como string "22; DROP" ou objeto => 400', async () => {
    for (const setpoint of ["22; DROP TABLE SALA", { $gt: 0 }, [22], null, true]) {
      const r = await api.req("/api/salas/1/setpoint", { method: "PUT", token: tk.op1, body: { setpoint } });
      assert.equal(r.status, 400, `aceitou ${JSON.stringify(setpoint)}`);
    }
  });

  test("numero infinito (1e309) e valores fora da faixa => 400", async () => {
    const inf = await api.req("/api/salas/1/vav", { method: "PUT", token: tk.op1, bruto: '{"abertura":1e309}' });
    assert.equal(inf.status, 400);
    const fora = await api.req("/api/climatizadores/1", { method: "PUT", token: tk.op1, body: { tempInsuflamento: 500 } });
    assert.equal(fora.status, 400);
  });

  test('telemetria com valor "999" (string), objeto ou id "1 OR 1=1" => 400', async () => {
    const { token } = usuarios.criarDispositivo({ nome: "ESP injecao", idSala: 1 });
    const id = sensorDa(1);
    for (const body of [
      { id_sensor: id, valor: "999" },
      { id_sensor: id, valor: { $gt: 0 } },
      { id_sensor: "1 OR 1=1", valor: 20 },
      { id_sensor: id, valor: 20, qualidade: "<script>" },
    ]) {
      const r = await api.req("/api/telemetria", { method: "POST", headers: { "X-Device-Token": token }, body });
      assert.equal(r.status, 400, `aceitou ${JSON.stringify(body)}`);
    }
  });

  test("leitura fisicamente impossivel (999 C) nao vira dado nem alerta falso", () => {
    const antes = db.prepare("SELECT COUNT(*) c FROM ALERTA").get().c;
    const r = logic.inserirLeitura({ id_sensor: sensorDa(2), valor: 999 });
    assert.equal(r.ok, false);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM ALERTA").get().c, antes);
  });
});

describe("Prototype pollution / mass assignment", () => {
  test('"__proto__" no corpo do login => 400 e Object.prototype intacto', async () => {
    const r = await api.req("/api/login", {
      method: "POST",
      bruto: `{"login":"viewer","senha":"x","__proto__":{"papel":"admin","isAdmin":true}}`,
    });
    assert.equal(r.status, 400);
    assert.equal({}.papel, undefined);
    assert.equal({}.isAdmin, undefined);
  });

  test('"constructor.prototype" no corpo de comando => 400', async () => {
    const r = await api.req("/api/salas/1/setpoint", {
      method: "PUT",
      token: tk.op1,
      body: { setpoint: 22, constructor: { prototype: { papel: "admin" } } },
    });
    assert.equal(r.status, 400);
  });

  test('campo extra "papel" ao trocar senha => 400', async () => {
    const r = await api.req(`/api/usuarios/${api.contas.operador1.id}/senha`, {
      method: "PUT",
      token: tk.op1,
      body: { senhaAtual: SENHAS.operador1, novaSenha: "Outra-Senha-Forte-1", papel: "admin" },
    });
    assert.equal(r.status, 400);
    assert.equal(usuarios.buscarUsuarioPorLogin("operador1").papel, "operator");
  });
});

describe("XSS armazenado", () => {
  for (const nome of ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "javascript:alert(1)", "Sala\" onmouseover=\"x"]) {
    test(`nome ${JSON.stringify(nome)} => 400 e nao e gravado`, async () => {
      const r = await api.req("/api/salas/completa", { method: "POST", token: tk.admin, body: { nome, idClimatizador: 1 } });
      assert.equal(r.status, 400);
      assert.equal(db.prepare("SELECT COUNT(*) c FROM SALA WHERE nome = ?").get(nome).c, 0);
    });
  }

  test("nome legitimo com acentos e numeros e aceito", async () => {
    const r = await api.req("/api/salas/completa", {
      method: "POST",
      token: tk.admin,
      body: { nome: "Sala de Reunião 2º andar (B-12)", idClimatizador: 1 },
    });
    assert.equal(r.status, 201);
  });

  test("respostas sao JSON com nosniff e Content-Security-Policy", async () => {
    const r = await api.req("/api/salas", { token: tk.admin });
    assert.match(r.headers.get("content-type"), /^application\/json/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
  });
});

describe("Injecao de formula em CSV (exportacao da auditoria)", () => {
  for (const [entrada, esperado] of [
    ['=HYPERLINK("http://malicioso.example","clique")', `"'=HYPERLINK(""http://malicioso.example"",""clique"")"`],
    ["+cmd|' /C calc'!A0", `"'+cmd|' /C calc'!A0"`],
    ["-2+3", `"'-2+3"`],
    ["@SUM(A1:A9)", `"'@SUM(A1:A9)"`],
    ["\t=1+1", `"'\t=1+1"`],
  ]) {
    test(`neutraliza ${JSON.stringify(entrada)}`, () => assert.equal(escCsv(entrada), esperado));
  }

  test("texto normal so ganha aspas; aspas internas sao duplicadas", () => {
    assert.equal(escCsv("Sala 1: temperatura alta"), '"Sala 1: temperatura alta"');
    assert.equal(escCsv('ele disse "oi"'), '"ele disse ""oi"""');
    assert.equal(escCsv(null), '""');
  });
});

describe("Execucao de codigo e vazamento de informacao", () => {
  test("backend nao usa eval / new Function / child_process / exec", () => {
    const arquivos = arquivosDoBackend();
    assert.ok(arquivos.length >= 15, "varredura nao encontrou os arquivos do backend");
    for (const f of arquivos) {
      const src = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(src, /\beval\s*\(|new\s+Function\s*\(|child_process|\bexecSync?\s*\(|\bspawn\s*\(/, f);
    }
  });

  test("JSON malformado => 400 sem stack trace nem caminho de arquivo", async () => {
    const r = await api.req("/api/login", { method: "POST", bruto: '{"login": "admin", "senha": ' });
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.texto, /node_modules|at \w+ \(|\/home\/|C:\\\\|SyntaxError/);
  });

  test("erro de validacao devolve so campo/mensagem (sem SQL nem stack)", async () => {
    const r = await api.req("/api/salas/1/vav", { method: "PUT", token: tk.op1, body: { abertura: "abc" } });
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.texto, /SELECT|UPDATE|sqlite|stack/i);
  });
});
