// ---------------------------------------------------------------------------
// Rota dos DISPOSITIVOS (ESP32): token proprio no cabecalho X-Device-Token.
// IDOR: o dispositivo so grava em sensores da PROPRIA sala.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { db } from "../banco/db.js";
import { telemetriaSchema } from "../seguranca/validacao.js";
import { inserirLeitura } from "../servicos/leituras.js";

export function rotasTelemetria({ limitadores, autenticarDispositivo }) {
  const r = Router();

  // POST /api/telemetria { id_sensor, valor, qualidade? }
  r.post("/telemetria", autenticarDispositivo, limitadores.telemetria, (req, res) => {
    const { id_sensor, valor, qualidade } = telemetriaSchema.parse(req.body);
    const sensor = db.prepare("SELECT id_sala FROM SENSOR WHERE id_sensor = ?").get(id_sensor);
    if (!sensor || sensor.id_sala !== req.dispositivo.id_sala) {
      return res.status(403).json({ erro: "sensor nao pertence a este dispositivo" });
    }
    const resultado = inserirLeitura({ id_sensor, valor, qualidade });
    res.status(resultado.ok ? 201 : 400).json(resultado);
  });

  return r;
}
