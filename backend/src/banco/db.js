import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Padrao: backend/hvac.db (mesmo lugar de sempre, fora de src/).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "..", "hvac.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Cria as tabelas (idempotente) a partir do schema conforme a DER
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// ---------------------------------------------------------------------------
// Camada framework (migracao): bancos ja existentes (como o hvac.db deste
// projeto) foram criados antes da adicao de setpoint/modo/motivo/ligado/
// temp_insuflamento. CREATE TABLE IF NOT EXISTS nao adiciona colunas em
// tabela ja existente, entao migramos aqui, sem apagar nenhum dado.
// ---------------------------------------------------------------------------
migrar();

function colunas(tabela) {
  return db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
}

function migrar() {
  const climaCols = colunas("CLIMATIZADOR");
  if (climaCols.includes("stauts") && !climaCols.includes("status")) {
    db.exec(`ALTER TABLE CLIMATIZADOR RENAME COLUMN "stauts" TO "status"`);
  }
  if (!colunas("CLIMATIZADOR").includes("ligado")) {
    db.exec(`ALTER TABLE CLIMATIZADOR ADD COLUMN ligado INTEGER DEFAULT 1`);
    db.exec(`UPDATE CLIMATIZADOR SET ligado = CASE WHEN status = 'desligado' THEN 0 ELSE 1 END`);
  }
  if (!colunas("CLIMATIZADOR").includes("temp_insuflamento")) {
    db.exec(`ALTER TABLE CLIMATIZADOR ADD COLUMN temp_insuflamento REAL DEFAULT 15`);
  }
  if (!colunas("SALA").includes("setpoint")) {
    db.exec(`ALTER TABLE SALA ADD COLUMN setpoint REAL DEFAULT 23`);
  }
  if (!colunas("VAV").includes("modo")) {
    db.exec(`ALTER TABLE VAV ADD COLUMN modo TEXT DEFAULT 'auto'`);
  }
  if (!colunas("VAV").includes("motivo")) {
    db.exec(`ALTER TABLE VAV ADD COLUMN motivo TEXT DEFAULT 'estavel'`);
  }
  if (!colunas("ALERTA").includes("reconhecido")) {
    db.exec(`ALTER TABLE ALERTA ADD COLUMN reconhecido INTEGER DEFAULT 0`);
  }
  // Seguranca: "limpar reconhecidos" passa a ARQUIVAR (nao apaga a trilha) e o
  // reconhecimento registra quem e quando.
  if (!colunas("ALERTA").includes("arquivado")) {
    db.exec(`ALTER TABLE ALERTA ADD COLUMN arquivado INTEGER DEFAULT 0`);
  }
  if (!colunas("ALERTA").includes("reconhecido_por")) {
    db.exec(`ALTER TABLE ALERTA ADD COLUMN reconhecido_por INTEGER`);
    db.exec(`ALTER TABLE ALERTA ADD COLUMN reconhecido_em TEXT`);
  }
}

// Seed inicial (somente se o banco estiver vazio)
const vazio = db.prepare("SELECT COUNT(*) AS c FROM CLIMATIZADOR").get().c === 0;
if (vazio) seed();

function seed() {
  const insClima = db.prepare("INSERT INTO CLIMATIZADOR (nome, status, capacidade) VALUES (?, ?, ?)");
  const insSala = db.prepare("INSERT INTO SALA (nome, andar, status, id_climatizador) VALUES (?, ?, ?, ?)");
  const insVav = db.prepare("INSERT INTO VAV (status, abertura, vazao_ar, id_sala) VALUES (?, ?, ?, ?)");
  const insSensor = db.prepare("INSERT INTO SENSOR (tipo, unidade, status, id_sala) VALUES (?, ?, ?, ?)");
  const insLimite = db.prepare("INSERT INTO LIMITE_ALERTA (tipo, valor_min, valor_max, id_sala) VALUES (?, ?, ?, ?)");

  const tx = db.transaction(() => {
    
    const climaA = insClima.run("Climatizador A", "ligado", 60000).lastInsertRowid;
    const climaB = insClima.run("Climatizador B", "ligado", 60000).lastInsertRowid;

    
    const salas = [
      ["Sala 1", "1", "normal", climaA],
      ["Sala 2", "1", "normal", climaA],
      ["Sala 3", "1", "normal", climaB],
      ["Sala 4", "1", "normal", climaB],
    ].map((s) => insSala.run(...s).lastInsertRowid);

    // limites padrao: temp 20-26, umidade 40-60, co2 0-1000
    const limitesPadrao = [
      ["temperatura", 20, 26],
      ["umidade", 40, 60],
      ["co2", 0, 1000],
    ];
    // sensores padrao por sala + suas leituras vindas via MQTT/telemetria
    const sensoresPadrao = [
      ["temperatura", "C"],
      ["umidade", "%"],
      ["co2", "ppm"],
    ];

    for (const idSala of salas) {
      // 1 VAV por sala (relacao 1:1)
      insVav.run("ok", 40, 0, idSala);
      for (const [tipo, unidade] of sensoresPadrao) insSensor.run(tipo, unidade, "ativo", idSala);
      for (const [tipo, vmin, vmax] of limitesPadrao) insLimite.run(tipo, vmin, vmax, idSala);
    }
  });
  tx();
  if (process.env.NODE_ENV !== "test") console.log("Banco inicializado e populado (seed) com sucesso.");
}
