// ---------------------------------------------------------------------------
// CLIENTE MQTT AO VIVO (navegador -> broker via WebSocket)
// ---------------------------------------------------------------------------
// Assina diretamente o topico publicado pelo ESP32 (o mesmo do sketch Arduino)
// e entrega as leituras a dashboard, SEM backend intermediario.
//
// O ESP publica JSON como:
//   { "temperature": 24.1, "humidity": 55, "co": 3, "co2": 620, "pm25": 12,
//     "status": 0, "override": false }
//
// O navegador nao fala MQTT/TCP puro (porta 1883) — usa MQTT sobre WebSocket.
// HiveMQ publico: wss://broker.hivemq.com:8884/mqtt (TLS, funciona em paginas https).
// ---------------------------------------------------------------------------

import mqtt from "mqtt";

export const DEFAULT_URL = "wss://broker.hivemq.com:8884/mqtt";
// IMPORTANTE: use um topico UNICO seu (o broker publico e compartilhado).
// Deve ser igual ao "mqtt_topic" configurado no sketch do ESP32.
export const DEFAULT_TOPIC = "tcc-hvac-kaue/airquality";

export function createMqttLive({ url = DEFAULT_URL, topic = DEFAULT_TOPIC } = {}) {
  let client = null;
  const listeners = new Set();
  const state = { connected: false, connecting: true, lastData: null, lastTs: null, error: null, url, topic };

  const emit = () => listeners.forEach((fn) => fn({ ...state }));

  function connect() {
    // clientId aleatorio: evita conflito com outros clientes no broker publico
    const clientId = "tcc-dash-" + Math.random().toString(16).slice(2, 10);
    client = mqtt.connect(url, { clientId, reconnectPeriod: 3000, connectTimeout: 8000, clean: true });

    client.on("connect", () => {
      state.connected = true;
      state.connecting = false;
      state.error = null;
      client.subscribe(topic, (err) => {
        if (err) state.error = "Falha ao assinar o topico: " + err.message;
        emit();
      });
      emit();
    });
    client.on("reconnect", () => {
      state.connecting = true;
      emit();
    });
    client.on("close", () => {
      state.connected = false;
      emit();
    });
    client.on("error", (e) => {
      state.error = e?.message || String(e);
      emit();
    });
    client.on("message", (t, payload) => {
      try {
        const d = JSON.parse(payload.toString());
        // mescla (o ESP as vezes publica so o status) para nao perder leituras
        state.lastData = { ...(state.lastData || {}), ...d };
        state.lastTs = new Date().toISOString();
        emit();
      } catch {
        /* payload nao-JSON ignorado */
      }
    });
  }

  connect();

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
    disconnect() {
      try {
        client?.end(true);
      } catch {
        /* ignore */
      }
    },
  };
}
