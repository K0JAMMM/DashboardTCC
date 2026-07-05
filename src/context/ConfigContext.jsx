import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api/client.js";

const ConfigContext = createContext(null);

const POLL_MS = 3000;

export function ConfigProvider({ children }) {
  const [state, setState] = useState(null); // estado completo do sistema
  const [alerts, setAlerts] = useState([]);
  const [thresholds, setThresholds] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

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
    <ConfigContext.Provider value={{ state, alerts, thresholds, error, mode: api.mode, refresh, ...actions }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useSystem() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useSystem deve ser usado dentro de ConfigProvider");
  return ctx;
}
