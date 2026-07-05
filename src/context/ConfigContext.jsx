import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client.js";
import { createMqttLive, DEFAULT_URL, DEFAULT_TOPIC } from "../api/mqttLive.js";

const ConfigContext = createContext(null);

const POLL_MS = 3000;

export function ConfigProvider({ children }) {
  const [state, setState] = useState(null); // estado completo do sistema
  const [alerts, setAlerts] = useState([]);
  const [thresholds, setThresholds] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  // ----- ponte MQTT ao vivo (ESP32 -> uma sala) -----
  const [liveConfig, setLiveConfigState] = useState({
    enabled: false,
    url: DEFAULT_URL,
    topic: DEFAULT_TOPIC,
    salaAlvo: "sala-1",
  });
  const [liveStatus, setLiveStatus] = useState({ connected: false, connecting: false, lastData: null, lastTs: null, error: null });
  const mqttRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.getSystemState(), api.getAlerts()]);
      if (!mounted.current) return;
      setState(s);
      setAlerts(a);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    api.getThresholds().then(setThresholds).catch(() => {});
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  // Ponte MQTT: quando habilitada, assina o broker e injeta as leituras do ESP
  // na sala-alvo (que passa a NAO ser simulada). Reconecta quando a config muda.
  useEffect(() => {
    mqttRef.current?.disconnect();
    mqttRef.current = null;

    if (!liveConfig.enabled) {
      api.setFonteExterna(null).then(refresh).catch(() => {});
      setLiveStatus({ connected: false, connecting: false, lastData: null, lastTs: null, error: null });
      return;
    }

    api.setFonteExterna(liveConfig.salaAlvo).then(refresh).catch(() => {});
    const client = createMqttLive({ url: liveConfig.url, topic: liveConfig.topic });
    mqttRef.current = client;
    const unsub = client.subscribe((s) => {
      setLiveStatus(s);
      if (s.lastData) {
        const d = s.lastData;
        api
          .ingestTelemetry({ salaId: liveConfig.salaAlvo, temperatura: d.temperature, umidade: d.humidity, co2: d.co2 })
          .then(refresh)
          .catch(() => {});
      }
    });
    return () => {
      unsub();
      client.disconnect();
    };
  }, [liveConfig, refresh]);

  const setLiveConfig = useCallback((patch) => {
    setLiveConfigState((c) => ({ ...c, ...patch }));
  }, []);

  // ----- acoes -----
  const actions = {
    async saveThresholds(salaId, next) {
      const saved = await api.saveThresholds(salaId, next);
      setThresholds(saved);
      refresh();
      return saved;
    },
    async setVav(roomId, abertura) {
      await api.setVav(roomId, abertura);
      refresh();
    },
    async setVavMode(roomId, modo) {
      await api.setVavMode(roomId, modo);
      refresh();
    },
    async setRoomSetpoint(roomId, setpoint) {
      await api.setRoomSetpoint(roomId, setpoint);
      refresh();
    },
    async setVavFault(roomId, falha) {
      await api.setVavFault(roomId, falha);
      refresh();
    },
    async setClimatizador(id, patch) {
      await api.setClimatizador(id, patch);
      refresh();
    },
    async setBathroomLight(id, luz) {
      await api.setBathroomLight(id, luz);
      refresh();
    },
    async acknowledgeAlert(id) {
      const next = await api.acknowledgeAlert(id);
      setAlerts(next);
    },
    async clearAcknowledged() {
      const next = await api.clearAcknowledged();
      setAlerts(next);
    },
  };

  return (
    <ConfigContext.Provider
      value={{ state, alerts, thresholds, error, mode: api.mode, refresh, liveConfig, liveStatus, setLiveConfig, ...actions }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useSystem() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useSystem deve ser usado dentro de ConfigProvider");
  return ctx;
}
