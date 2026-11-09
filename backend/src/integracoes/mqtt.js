// ---------------------------------------------------------------------------
// Ponte MQTT: assina o topico do ESP32 e grava as leituras nos sensores da sala.
// O backend (Node) fala MQTT/TCP direto (porta 1883) - diferente do navegador.
// ---------------------------------------------------------------------------

import mqtt from "mqtt";
import { db } from "../banco/db.js";
import { inserirLeitura } from "../servicos/leituras.js";


// Mapeia as chaves do JSON publicado pelo ESP -> tipo do SENSOR na DER
const MAPA = { temperature: "temperatura", humidity: "umidade", co2: "co2" };

// cfg = config.mqtt ({ url, topic, username, password, salaId }) - sem defaults publicos.
export function startMqtt(cfg) {
  if (!cfg?.url || !cfg?.topic) {
    console.log("MQTT desativado (defina MQTT_URL e MQTT_TOPIC no .env para ativar).");
    return null;
  }
  const { url: MQTT_URL, topic: MQTT_TOPIC, salaId: SALA_ID } = cfg;
  const client = mqtt.connect(MQTT_URL, {
    username: cfg.username,
    password: cfg.password,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    console.log(`MQTT conectado (${MQTT_URL}), assinando "${MQTT_TOPIC}" -> Sala ${SALA_ID}`);
    client.subscribe(MQTT_TOPIC, (err) => err && console.error("Falha ao assinar:", err.message));
  });
  client.on("error", (e) => console.error("MQTT erro:", e.message));

  client.on("message", (_topic, payload) => {
    if (payload.length > 4096) return; // payload gigante: descarta
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
