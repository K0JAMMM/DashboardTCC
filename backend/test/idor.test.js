// ===========================================================================
// TESTES DE SEGURANCA 1/4 - IDOR (Insecure Direct Object Reference)
//
// Ataque: o usuario esta logado e simplesmente TROCA O ID na URL/corpo
// (/api/salas/1 -> /api/salas/3, /api/usuarios/2 -> /api/usuarios/1) para
// ler ou comandar um objeto que nao e dele.
// Defesa: autenticacao + checagem de posse por objeto em cada rota.
// ===========================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { iniciarApi, db, usuarios, sensorDa, gerarAlerta } from "./helpers.js";

let api, tk;

before(async () => {
  api = await iniciarApi();
  tk = {
    admin: await api.login("admin"),
    op1: await api.login("operador1"), // salas 1 e 2
    op2: await api.login("operador2"), // salas 3 e 4
    viewer: await api.login("viewer"),
  };
});
after(() => api?.fechar());

const vavDa = (idSala) => db.prepare("SELECT abertura FROM VAV WHERE id_sala = ?").get(idSala).abertura;

describe("IDOR - acesso sem autenticacao", () => {
  for (const [metodo, rota] of [
    ["GET", "/api/estado"],
    ["GET", "/api/salas/1"],
    ["GET", "/api/usuarios/1"],
    ["GET", "/api/leituras"],
    ["PUT", "/api/salas/1/vav"],
    ["PUT", "/api/climatizadores/1"],
    ["POST", "/api/alertas/1/reconhecer"],
  ]) {
    test(`${metodo} ${rota} sem token => 401`, async () => {
      const r = await api.req(rota, { method: metodo, body: metodo === "GET" ? undefined : {} });
      assert.equal(r.status, 401);
    });
  }
});

describe("IDOR - comandos em salas de outro operador", () => {
  test("operador1 comanda a PROPRIA sala 1 => 200", async () => {
    const r = await api.req("/api/salas/1/vav", { method: "PUT", token: tk.op1, body: { abertura: 55 } });
    assert.equal(r.status, 200);
    assert.equal(vavDa(1), 55);
  });

  test("operador1 troca o ID para a sala 3 (do operador2) => 403 e a VAV NAO muda", async () => {
    const antes = vavDa(3);
    const r = await api.req("/api/salas/3/vav", { method: "PUT", token: tk.op1, body: { abertura: 100 } });
    assert.equal(r.status, 403);
    assert.equal(vavDa(3), antes);
  });

  test("operador1 nao altera setpoint nem modo da sala 4 => 403", async () => {
    const sp = await api.req("/api/salas/4/setpoint", { method: "PUT", token: tk.op1, body: { setpoint: 18 } });
    const modo = await api.req("/api/salas/4/vav/modo", { method: "PUT", token: tk.op1, body: { modo: "manual" } });
    assert.equal(sp.status, 403);
    assert.equal(modo.status, 403);
    assert.notEqual(db.prepare("SELECT setpoint FROM SALA WHERE id_sala = 4").get().setpoint, 18);
  });

  test("varredura de IDs 1..6 pelo operador2: so as salas 3 e 4 aceitam comando", async () => {
    const aceitas = [];
    for (let id = 1; id <= 6; id++) {
      const r = await api.req(`/api/salas/${id}/setpoint`, { method: "PUT", token: tk.op2, body: { setpoint: 22 } });
      if (r.status === 200) aceitas.push(id);
      else assert.ok([403, 404].includes(r.status), `sala ${id} retornou ${r.status}`);
    }
    assert.deepEqual(aceitas, [3, 4]);
  });

  test("operador1 liga/desliga o climatizador A (atende salas 1 e 2) => 200", async () => {
    const r = await api.req("/api/climatizadores/1", { method: "PUT", token: tk.op1, body: { ligado: true } });
    assert.equal(r.status, 200);
  });

  test("operador1 tenta desligar o climatizador B (salas 3 e 4) => 403", async () => {
    db.prepare("UPDATE CLIMATIZADOR SET ligado = 1 WHERE id_climatizador = 2").run();
    const r = await api.req("/api/climatizadores/2", { method: "PUT", token: tk.op1, body: { ligado: false } });
    assert.equal(r.status, 403);
    assert.equal(db.prepare("SELECT ligado FROM CLIMATIZADOR WHERE id_climatizador = 2").get().ligado, 1);
  });

  test("viewer (somente leitura) nao comanda nenhuma sala => 403", async () => {
    const r = await api.req("/api/salas/1/vav", { method: "PUT", token: tk.viewer, body: { abertura: 10 } });
    assert.equal(r.status, 403);
  });

  test("rota de simular falha e exclusiva de admin => operador recebe 403", async () => {
    const r = await api.req("/api/salas/1/vav/falha", { method: "PUT", token: tk.op1, body: { falha: true } });
    assert.equal(r.status, 403);
  });
});

describe("IDOR - alertas", () => {
  test("operador1 nao reconhece alerta da sala 3 => 403 e o alerta continua pendente", async () => {
    const alerta = gerarAlerta(3);
    const r = await api.req(`/api/alertas/${alerta.id_alerta}/reconhecer`, { method: "POST", token: tk.op1 });
    assert.equal(r.status, 403);
    assert.equal(db.prepare("SELECT reconhecido FROM ALERTA WHERE id_alerta = ?").get(alerta.id_alerta).reconhecido, 0);
  });

  test("quem reconheceu vem do TOKEN, nao do corpo (nao da para culpar outro usuario)", async () => {
    const alerta = gerarAlerta(1);
    const r = await api.req(`/api/alertas/${alerta.id_alerta}/reconhecer`, {
      method: "POST",
      token: tk.op1,
      body: { reconhecido_por: api.contas.admin.id, id_usuario: api.contas.admin.id },
    });
    assert.equal(r.status, 200);
    const row = db.prepare("SELECT reconhecido, reconhecido_por FROM ALERTA WHERE id_alerta = ?").get(alerta.id_alerta);
    assert.equal(row.reconhecido, 1);
    assert.equal(row.reconhecido_por, api.contas.operador1.id);
  });

  test("'limpar reconhecidos' do operador1 nao some com alertas das salas do operador2", async () => {
    const a3 = gerarAlerta(4);
    db.prepare("UPDATE ALERTA SET reconhecido = 1 WHERE id_alerta = ?").run(a3.id_alerta);
    const r = await api.req("/api/alertas/reconhecidos", { method: "DELETE", token: tk.op1 });
    assert.equal(r.status, 200);
    assert.equal(db.prepare("SELECT COALESCE(arquivado,0) a FROM ALERTA WHERE id_alerta = ?").get(a3.id_alerta).a, 0);
  });
});

describe("IDOR - dados de outros usuarios", () => {
  test("operador1 le o PROPRIO perfil => 200", async () => {
    const r = await api.req(`/api/usuarios/${api.contas.operador1.id}`, { token: tk.op1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.login, "operador1");
  });

  test("operador1 troca o ID para ler o perfil do admin => 404 (nem revela que existe)", async () => {
    const r = await api.req(`/api/usuarios/${api.contas.admin.id}`, { token: tk.op1 });
    assert.equal(r.status, 404);
    assert.ok(!r.texto.includes("admin"));
  });

  test("varredura de /api/usuarios/1..20 pelo viewer so encontra ele mesmo", async () => {
    const encontrados = [];
    for (let id = 1; id <= 20; id++) {
      const r = await api.req(`/api/usuarios/${id}`, { token: tk.viewer });
      if (r.status === 200) encontrados.push(r.body.login);
    }
    assert.deepEqual(encontrados, ["viewer"]);
  });

  test("listar todos os usuarios e exclusivo do admin", async () => {
    assert.equal((await api.req("/api/usuarios", { token: tk.op1 })).status, 403);
    const r = await api.req("/api/usuarios", { token: tk.admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 4);
  });

  test("operador1 nao troca a senha do operador2 => 404 e a senha do operador2 continua valendo", async () => {
    const r = await api.req(`/api/usuarios/${api.contas.operador2.id}/senha`, {
      method: "PUT",
      token: tk.op1,
      body: { novaSenha: "Senha-Do-Atacante-2024!" },
    });
    assert.equal(r.status, 404);
    assert.ok(await api.login("operador2")); // senha original ainda funciona
  });

  test("operador nao cria usuario (escalada de privilegio) => 403", async () => {
    const r = await api.req("/api/usuarios", {
      method: "POST",
      token: tk.op1,
      body: { login: "intruso", senha: "Intruso-Forte-123!", papel: "admin" },
    });
    assert.equal(r.status, 403);
    assert.equal(usuarios.buscarUsuarioPorLogin("intruso"), undefined);
  });
});

describe("IDOR - mass assignment (trocar chave estrangeira pelo corpo)", () => {
  test("mover sensor para outra sala via PUT /api/sensores/:id => rota de escrita nao existe (404)", async () => {
    const id = sensorDa(1);
    const r = await api.req(`/api/sensores/${id}`, { method: "PUT", token: tk.admin, body: { id_sala: 3 } });
    assert.equal(r.status, 404);
    assert.equal(db.prepare("SELECT id_sala FROM SENSOR WHERE id_sensor = ?").get(id).id_sala, 1);
  });

  test("reatribuir sala a outro climatizador pelo corpo => 400 (campo fora da allowlist)", async () => {
    const r = await api.req("/api/salas/1", { method: "PUT", token: tk.admin, body: { id_climatizador: 2 } });
    assert.equal(r.status, 400);
    assert.equal(db.prepare("SELECT id_climatizador FROM SALA WHERE id_sala = 1").get().id_climatizador, 1);
  });

  test("apagar leituras/alertas (trilha de auditoria) pela API => 404", async () => {
    assert.equal((await api.req("/api/leituras/1", { method: "DELETE", token: tk.admin })).status, 404);
    assert.equal((await api.req("/api/alertas/1", { method: "DELETE", token: tk.admin })).status, 404);
  });

  test("mesmo direto no banco, LEITURA_SENSOR e append-only (trigger)", () => {
    assert.throws(() => db.prepare("DELETE FROM LEITURA_SENSOR").run(), /append-only/);
    assert.throws(() => db.prepare("UPDATE LEITURA_SENSOR SET valor = 0").run(), /append-only/);
  });
});

describe("IDOR - dispositivos (ESP32)", () => {
  let tokenEsp1;
  before(() => {
    tokenEsp1 = usuarios.criarDispositivo({ nome: "ESP32 Sala 1", idSala: 1 }).token;
  });

  test("telemetria sem token de dispositivo => 401", async () => {
    const r = await api.req("/api/telemetria", { method: "POST", body: { id_sensor: sensorDa(1), valor: 22 } });
    assert.equal(r.status, 401);
  });

  test("ESP32 da sala 1 grava no PROPRIO sensor => 201", async () => {
    const r = await api.req("/api/telemetria", {
      method: "POST",
      headers: { "X-Device-Token": tokenEsp1 },
      body: { id_sensor: sensorDa(1), valor: 22.5 },
    });
    assert.equal(r.status, 201);
  });

  test("ESP32 da sala 1 troca o id_sensor para um sensor da sala 3 => 403 e nada e gravado", async () => {
    const alvo = sensorDa(3);
    const antes = db.prepare("SELECT COUNT(*) c FROM LEITURA_SENSOR WHERE id_sensor = ?").get(alvo).c;
    const r = await api.req("/api/telemetria", {
      method: "POST",
      headers: { "X-Device-Token": tokenEsp1 },
      body: { id_sensor: alvo, valor: 80 },
    });
    assert.equal(r.status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM LEITURA_SENSOR WHERE id_sensor = ?").get(alvo).c, antes);
  });

  test("token de usuario (JWT) nao serve como token de dispositivo => 401", async () => {
    const r = await api.req("/api/telemetria", {
      method: "POST",
      headers: { "X-Device-Token": tk.admin },
      body: { id_sensor: sensorDa(1), valor: 22 },
    });
    assert.equal(r.status, 401);
  });
});
