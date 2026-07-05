import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";

const CATEGORIAS = {
  alerta: { txt: "Alerta", cor: "var(--color-critical)" },
  reconhecimento: { txt: "Reconhec.", cor: "var(--color-secondary)" },
  parametro: { txt: "Parâmetro", cor: "var(--color-primary)" },
  setpoint: { txt: "Setpoint", cor: "var(--color-primary)" },
  vav: { txt: "VAV", cor: "var(--color-secondary)" },
  climatizador: { txt: "Climatizador", cor: "var(--color-primary)" },
  exaustao: { txt: "Exaustão", cor: "var(--color-success)" },
  registro: { txt: "Registro", cor: "var(--color-text-muted)" },
};

const FILTROS = [
  { key: "todos", txt: "Todos" },
  { key: "alerta", txt: "Alertas" },
  { key: "operador", txt: "Ações do operador" },
  { key: "registro", txt: "Registros" },
];

function CatBadge({ categoria }) {
  const c = CATEGORIAS[categoria] || { txt: categoria, cor: "var(--color-text-muted)" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: c.cor, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {c.txt}
    </span>
  );
}

const esc = (c) => `"${String(c ?? "").replace(/"/g, '""')}"`;

// CSV no formato de registro exigido pelo PMOC / NBR 7256:
// cabecalho com identificacao do estabelecimento, responsavel tecnico e metadados.
function exportarCSV(rows, ident) {
  const now = new Date().toLocaleString("pt-BR");
  const ini = rows.length ? new Date(rows[rows.length - 1].ts).toLocaleString("pt-BR") : "-";
  const fim = rows.length ? new Date(rows[0].ts).toLocaleString("pt-BR") : "-";
  const meta = [
    ["Relatorio de Auditoria - Sistema de Automacao HVAC"],
    ["Base normativa", "ABNT NBR 7256; PMOC Lei 13.589/2018; ANVISA RE 09/2003"],
    ["Estabelecimento (EAS)", ident.estabelecimento],
    ["CNES", ident.cnes],
    ["Sistema", ident.sistema],
    ["Responsavel tecnico", ident.responsavelTecnico],
    ["Registro profissional (CREA/CFT) e ART/TRT", ident.registro],
    ["Gerado em", now],
    ["Periodo dos registros", `${ini} a ${fim}`],
    ["Total de eventos", rows.length],
    [],
    ["Data/Hora", "Categoria", "Origem", "Sala", "Descricao"],
  ];
  const dataRows = rows.map((e) => [
    new Date(e.ts).toLocaleString("pt-BR"),
    CATEGORIAS[e.categoria]?.txt || e.categoria,
    e.origem === "operador" ? "Operador" : "Sistema",
    e.salaId || "",
    e.descricao,
  ]);
  const csv = [...meta, ...dataRows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `auditoria-hvac-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LogsPage() {
  const [eventos, setEventos] = useState([]);
  const [filtro, setFiltro] = useState("todos");
  const [ident, setIdent] = useState(null);
  const [identSaved, setIdentSaved] = useState(false);

  useEffect(() => {
    const load = () => api.getEvents().then(setEventos);
    load();
    const id = setInterval(load, 4000);
    api.getIdentificacao().then(setIdent);
    return () => clearInterval(id);
  }, []);

  const filtrados = useMemo(() => {
    return eventos.filter((e) => {
      if (filtro === "todos") return true;
      if (filtro === "operador") return e.origem === "operador";
      return e.categoria === filtro;
    });
  }, [eventos, filtro]);

  const salvarIdent = async () => {
    const saved = await api.saveIdentificacao(ident);
    setIdent(saved);
    setIdentSaved(true);
    setTimeout(() => setIdentSaved(false), 2500);
  };

  const identIncompleta = ident && (!ident.estabelecimento || !ident.responsavelTecnico || !ident.registro);

  return (
    <>
      {/* Identificacao do documento (exigida por PMOC / NBR 7256) */}
      {ident && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="card__title">Identificação do Relatório (PMOC / NBR 7256)</h3>
          <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
            Dados obrigatórios do registro para validade legal. Preenchidos, entram no cabeçalho do CSV exportado.
          </p>
          <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Estabelecimento (EAS)</label>
              <input value={ident.estabelecimento} onChange={(e) => setIdent({ ...ident, estabelecimento: e.target.value })} placeholder="Nome do hospital/clínica" />
            </div>
            <div className="field">
              <label>CNES</label>
              <input value={ident.cnes} onChange={(e) => setIdent({ ...ident, cnes: e.target.value })} placeholder="Cód. Nacional de Estab. de Saúde" />
            </div>
          </div>
          <div className="form-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="field">
              <label>Responsável técnico</label>
              <input value={ident.responsavelTecnico} onChange={(e) => setIdent({ ...ident, responsavelTecnico: e.target.value })} placeholder="Eng. Mecânico responsável" />
            </div>
            <div className="field">
              <label>Registro profissional + ART/TRT</label>
              <input value={ident.registro} onChange={(e) => setIdent({ ...ident, registro: e.target.value })} placeholder="CREA/CFT nº • ART nº" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
            <button className="btn btn--primary" onClick={salvarIdent}>Salvar identificação</button>
            {identSaved && <span style={{ color: "var(--color-success)", fontWeight: 600 }}>✓ Salvo</span>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="banner" style={{ background: "#eef4fb", borderColor: "#cfe0f2", color: "#0b3a63" }}>
          <span>📋</span>
          <span>
            Registro de auditoria para <strong>rastreabilidade</strong> (ABNT NBR 7256 e PMOC — Lei 13.589/2018).
            Guarda alertas, ações do operador e registros ambientais periódicos. Exporte em CSV para inspeções da
            Vigilância Sanitária / acreditação (ONA, JCI).
          </span>
        </div>

        {identIncompleta && (
          <div className="banner">
            <span>⚠️</span>
            <span>
              Preencha <strong>Estabelecimento</strong>, <strong>Responsável técnico</strong> e <strong>Registro/ART</strong> acima:
              sem eles o relatório fica incompleto para fins de fiscalização.
            </span>
          </div>
        )}

        <div className="row-between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTROS.map((f) => (
              <button key={f.key} className={`btn ${filtro === f.key ? "btn--primary" : "btn--ghost"}`} style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setFiltro(f.key)}>
                {f.txt}
              </button>
            ))}
          </div>
          <button className="btn btn--primary" onClick={() => exportarCSV(filtrados, ident || {})} disabled={!filtrados.length}>
            ⭳ Exportar CSV ({filtrados.length})
          </button>
        </div>

        {filtrados.length === 0 ? (
          <div className="empty">Nenhum evento registrado ainda. Interaja com o sistema para gerar registros.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-muted)", borderBottom: "2px solid var(--color-border)" }}>
                  <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>Data/Hora</th>
                  <th style={{ padding: "8px 10px" }}>Categoria</th>
                  <th style={{ padding: "8px 10px" }}>Origem</th>
                  <th style={{ padding: "8px 10px", width: "100%" }}>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((e) => (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>{new Date(e.ts).toLocaleString("pt-BR")}</td>
                    <td style={{ padding: "8px 10px" }}><CatBadge categoria={e.categoria} /></td>
                    <td style={{ padding: "8px 10px" }}><span className="pill">{e.origem === "operador" ? "Operador" : "Sistema"}</span></td>
                    <td style={{ padding: "8px 10px" }}>{e.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
