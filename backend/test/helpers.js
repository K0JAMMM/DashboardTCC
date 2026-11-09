// ---------------------------------------------------------------------------
// Utilitarios compartilhados pelos testes de seguranca.
//
// Cada arquivo de teste roda em um processo proprio (node --test), com um
// banco SQLite TEMPORARIO (o hvac.db de desenvolvimento nunca e tocado) e a
// API escutando numa porta aleatoria de 127.0.0.1. Os testes fazem
// requisicoes HTTP reais contra o codigo-fonte do backend.
// ---------------------------------------------------------------------------

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

export const JWT_SECRET_TESTE = crypto.randomBytes(48).toString("hex");

// Precisa ser definido ANTES do primeiro import de src/banco/db.js.
const DB_PATH = path.join(os.tmpdir(), `hvac-seguranca-${process.pid}-${Date.now()}.db`);
process.env.NODE_ENV = "test";
process.env.DB_PATH = DB_PATH;

const { db } = await import("../src/banco/db.js");
const { carregarConfig } = await import("../src/config.js");
const { createApp } = await import("../src/app.js");
const usuarios = await import("../src/servicos/usuarios.js");
const logic = await import("../src/servicos/leituras.js");

export { db, usuarios, logic, carregarConfig };

// Senhas fortes usadas pelos usuarios de teste (geradas a cada execucao).
const forte = (prefixo) => `${prefixo}-${crypto.randomBytes(6).toString("hex")}-Aa1!`;
export const SENHAS = {
  admin: forte("Chefe"),
  operador1: forte("Turno1"),
  operador2: forte("Turno2"),
  viewer: forte("Leitor"),
};

// Usuarios do cenario:
//   admin      -> tudo
//   operador1  -> salas 1 e 2 (climatizador A)
//   operador2  -> salas 3 e 4 (climatizador B)
//   viewer     -> so leitura
let criados = null;
async function criarUsuariosDoCenario() {
  if (criados) return criados;
  const defs = [
    ["admin", "admin", []],
    ["operador1", "operator", [1, 2]],
    ["operador2", "operator", [3, 4]],
    ["viewer", "viewer", []],
  ];
  criados = {};
  for (const [login, papel, salas] of defs) {
    const r = await usuarios.criarUsuario({ login, senha: SENHAS[login], papel, salas });
    if (!r.ok) throw new Error(`falha ao criar ${login}: ${r.erro} ${r.detalhes}`);
    criados[login] = r.usuario;
  }
  return criados;
}

// Config de teste: limites altos (para nao interferir) salvo quando o teste
// de bots pede limites baixos explicitamente.
export function configTeste({ rateLimit = {}, bloqueio = {}, ...resto } = {}) {
  const base = carregarConfig({ JWT_SECRET: JWT_SECRET_TESTE, NODE_ENV: "test" });
  return {
    ...base,
    ...resto,
    rateLimit: { ...base.rateLimit, maxApi: 100_000, maxLogin: 100_000, maxTelemetria: 100_000, ...rateLimit },
    bloqueio: { ...base.bloqueio, maxFalhas: 1_000, ...bloqueio },
  };
}

/**
 * Sobe a API numa porta aleatoria e devolve helpers de requisicao.
 * @param {object} [opcoes] sobrescreve partes da config (ex.: { rateLimit: { maxLogin: 3 } })
 */
export async function iniciarApi(opcoes = {}) {
  const contas = await criarUsuariosDoCenario();
  const app = createApp(configTeste(opcoes));
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  /** Faz uma requisicao e devolve { status, headers, body, texto }. */
  async function req(caminho, { method = "GET", token, body, headers = {}, bruto } = {}) {
    const h = { "User-Agent": "testes-seguranca-tcc/1.0", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let corpo;
    if (bruto !== undefined) {
      corpo = bruto;
      h["Content-Type"] ??= "application/json";
    } else if (body !== undefined) {
      corpo = JSON.stringify(body);
      h["Content-Type"] = "application/json";
    }
    const res = await fetch(base + caminho, { method, headers: h, body: corpo });
    const texto = await res.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* nao-JSON */
    }
    return { status: res.status, headers: res.headers, body: json, texto };
  }

  async function login(loginNome, senha = SENHAS[loginNome]) {
    const r = await req("/api/login", { method: "POST", body: { login: loginNome, senha } });
    if (r.status !== 200) throw new Error(`login de ${loginNome} falhou: ${r.status} ${r.texto}`);
    return r.body.token;
  }

  const fechar = () => new Promise((ok) => servidor.close(ok));

  return { base, req, login, fechar, contas };
}

// IDs dos sensores de uma sala por tipo (seed: 3 sensores por sala).
export function sensorDa(idSala, tipo = "temperatura") {
  return db.prepare("SELECT id_sensor FROM SENSOR WHERE id_sala = ? AND tipo = ?").get(idSala, tipo).id_sensor;
}

// Gera um alerta real numa sala (leitura de temperatura acima do limite 26 C).
export function gerarAlerta(idSala, valor = 35) {
  const id = sensorDa(idSala, "temperatura");
  db.prepare("DELETE FROM ALERTA WHERE id_sensor = ? AND reconhecido = 0").run(id); // permite novo alerta (anti-duplicata 60s)
  logic.inserirLeitura({ id_sensor: id, valor });
  return db.prepare("SELECT * FROM ALERTA WHERE id_sensor = ? ORDER BY id_alerta DESC LIMIT 1").get(id);
}

// Lista todos os arquivos .js do codigo do backend (server.js, src/**, scripts/**),
// usada pelas verificacoes estaticas dos testes.
export function arquivosDoBackend() {
  const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const lista = [path.join(raiz, "server.js")];
  const andar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith(".js")) lista.push(p);
    }
  };
  andar(path.join(raiz, "src"));
  andar(path.join(raiz, "scripts"));
  return lista;
}

process.on("exit", () => {
  try {
    db.close();
    for (const suf of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + suf, { force: true });
  } catch {
    /* ignora */
  }
});
