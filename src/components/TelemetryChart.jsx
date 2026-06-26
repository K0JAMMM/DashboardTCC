import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { api } from "../api/client.js";
import { palette } from "../theme.js";

const METRICS = [
  { key: "temperatura", label: "Temperatura (°C)" },
  { key: "umidade", label: "Umidade (%)" },
  { key: "co2", label: "CO₂ (ppm)" },
];

const ROOM_COLORS = [palette.primary, palette.secondary, palette.success, "#8e6fcf"];

export default function TelemetryChart({ salas, thresholds }) {
  const [metric, setMetric] = useState("temperatura");
  const [roomFilter, setRoomFilter] = useState("todas"); // "todas" | salaId
  const [data, setData] = useState([]);

  const visiveis = roomFilter === "todas" ? salas : salas.filter((s) => s.id === roomFilter);

  useEffect(() => {
    let active = true;
    async function load() {
      const series = await Promise.all(visiveis.map((s) => api.getHistory(s.id, metric)));
      if (!active) return;
      const len = Math.max(0, ...series.map((s) => s.length));
      const merged = [];
      for (let i = 0; i < len; i++) {
        const point = {
          t: series[0]?.[i]?.t
            ? new Date(series[0][i].t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
            : i,
        };
        visiveis.forEach((s, idx) => {
          point[s.nome] = series[idx]?.[i]?.value ?? null;
        });
        merged.push(point);
      }
      setData(merged);
    }
    load();
    const id = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [metric, roomFilter, salas]);

  // Linhas de limite so aparecem quando uma unica sala esta selecionada
  // (cada sala tem suas proprias faixas).
  const refs = [];
  if (roomFilter !== "todas" && thresholds && thresholds[roomFilter]) {
    const t = thresholds[roomFilter];
    if (metric === "temperatura") {
      refs.push({ y: t.temperatura.min, label: "limite" }, { y: t.temperatura.max, label: "limite" });
    } else if (metric === "umidade") {
      refs.push({ y: t.umidade.min, label: "limite" }, { y: t.umidade.max, label: "limite" });
    } else {
      refs.push({ y: t.co2.warn, label: "atencao" }, { y: t.co2.critical, label: "critico" });
    }
  }

  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h3 className="card__title" style={{ margin: 0 }}>
          Histórico de Telemetria
        </h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={`btn ${metric === m.key ? "btn--primary" : "btn--ghost"}`}
              style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro de sala */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          className={`btn ${roomFilter === "todas" ? "btn--primary" : "btn--ghost"}`}
          style={{ padding: "5px 11px", fontSize: 12 }}
          onClick={() => setRoomFilter("todas")}
        >
          Todas
        </button>
        {salas.map((s) => (
          <button
            key={s.id}
            className={`btn ${roomFilter === s.id ? "btn--primary" : "btn--ghost"}`}
            style={{ padding: "5px 11px", fontSize: 12 }}
            onClick={() => setRoomFilter(s.id)}
          >
            {s.nome}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
          <XAxis dataKey="t" tick={{ fontSize: 11, fill: palette.text }} minTickGap={40} />
          <YAxis tick={{ fontSize: 11, fill: palette.text }} domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {refs.map((r, i) => (
            <ReferenceLine
              key={i}
              y={r.y}
              stroke={r.label === "critico" ? palette.critical : r.label === "atencao" ? palette.warning : "#94a3b8"}
              strokeDasharray="5 4"
              strokeWidth={1.4}
            />
          ))}
          {visiveis.map((s, idx) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.nome}
              stroke={ROOM_COLORS[salas.findIndex((x) => x.id === s.id) % ROOM_COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
