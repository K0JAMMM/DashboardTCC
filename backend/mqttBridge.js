// ---------------------------------------------------------------------------
// Ponte MQTT: assina o topico do ESP32 e grava as leituras nos sensores da sala.
// O backend (Node) fala MQTT/TCP direto (porta 1883) - diferente do navegador.
// ---------------------------------------------------------------------------

import mqtt from "mqtt";
import { db } from "./db.js";
import { inserirLeitura } from "./logic.js";

const MQTT_URL = process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "tcc-hvac-kaue/airquality";
const SALA_ID = Number(process.env.SALA_ID || 1); // sala que recebe os dados do ESP

// Mapeia as chaves do JSON publicado pelo ESP -> tipo do SENSOR na DER
const MAPA = { temperature: "temperatura", humidity: "umidade", co2: "co2" };

export function startMqtt() {
  const client = mqtt.connect(MQTT_URL);

  client.on("connect", () => {
    console.log(`MQTT conectado (${MQTT_URL}), assinando "${MQTT_TOPIC}" -> Sala ${SALA_ID}`);
    client.subscribe(MQTT_TOPIC, (err) => err && console.error("Falha ao assinar:", err.message));
  });
  client.on("error", (e) => console.error("MQTT erro:", e.message));

  client.on("message", (_topic, payload) => {
    let d;
    try {
      d = JSON.parse(payload.toString());
    } catch {
      return; // payload nao-JSON
    }
    for (const [chave, tipo] of Object.entries(MAPA)) {
      if (d[chave] == null) continue;
      const sensor = db.prepare("SELECT * FROM SENSOR WHERE id_sala = ? AND tipo = ?").get(SALA_ID, tipo);
      if (sensor) inserirLeitura({ id_sensor: sensor.id_sensor, valor: Number(d[chave]) });
    }
  });

  return client;
}
