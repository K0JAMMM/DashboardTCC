import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "hvac.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Cria as tabelas (idempotente) a partir do schema conforme a DER
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

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
  console.log("Banco inicializado e populado (seed) com sucesso.");
}
