# Contrato da API — Sistema de Automação HVAC (TCC)

Este documento define a interface entre os três componentes do sistema:

```
 ┌──────────┐   MQTT    ┌─────────────┐   REST/JSON   ┌──────────────┐
 │ Arduino/ │ ────────▶ │   Backend   │ ◀───────────▶ │  Dashboard   │
 │  ESP32   │ ◀──────── │ (API + bridge)│             │   (React)    │
 └──────────┘  comandos └─────────────┘                └──────────────┘
                              │ POST
                              ▼
                         ntfy.sh (alertas)
                              │
                          SQLite (histórico/eventos)
```

Arquitetura escolhida: **ambos os caminhos**. O Arduino publica telemetria via **MQTT**
(caminho principal, contínuo) e também pode usar **REST** (`POST /api/telemetria`) como
caminho alternativo/redundante. Os comandos do backend para o campo vão por MQTT.
A dashboard fala **somente REST** com o backend.

> A dashboard React já implementa este contrato. No modo `mock` ela usa um simulador
> interno (`src/api/mockBackend.js`) com exatamente os mesmos formatos abaixo, então ao
> ligar o backend real basta setar `VITE_API_MODE=real`.

---

## 1. Modelo de dados

### Sala
```json
{
  "id": "sala-1",
  "nome": "Sala 1",
  "climatizadorId": "clima-1",
  "temperatura": 22.6,
  "umidade": 51,
  "co2": 720,
  "vav": { "abertura": 60, "estado": "ok", "modo": "auto", "motivo": "resfriamento" },
  "ultimaLeitura": "2026-06-25T20:10:00.000Z",
  "status": { "temperatura": "normal", "umidade": "normal", "co2": "atencao" }
}
```
`status.*` ∈ `"normal" | "atencao" | "critico"` (calculado pelo backend a partir dos parâmetros).
`vav.estado` ∈ `"ok" | "falha"`. `vav.modo` ∈ `"auto" | "manual"`.
`vav.motivo` ∈ `"estavel" | "resfriamento" | "ventilacao" | "manual"` (apenas informativo, para a UI).

### Climatizador
```json
{ "id": "clima-1", "nome": "Climatizador A", "salas": ["sala-1","sala-2"], "ligado": true, "setpoint": 23 }
```

### Banheiro / exaustão
```json
{ "id": "ban-1", "nome": "Banheiro 1", "luz": false }
```
Exaustão: `ligada = luz(ban-1) OR luz(ban-2)` (RF10/RF11).

### Parâmetros (faixas de alerta — por sala)
As faixas são configuráveis **individualmente por sala**. O objeto é um mapa indexado por `salaId`:
```json
{
  "sala-1": {
    "temperatura": { "min": 20, "max": 26, "unit": "C" },
    "umidade":     { "min": 40, "max": 60, "unit": "%" },
    "co2":         { "warn": 800, "critical": 1200, "unit": "ppm" }
  },
  "sala-2": { "temperatura": { "min": 18, "max": 24, "unit": "C" }, "...": "..." }
}
```

### Alerta
```json
{
  "id": "alt-12", "level": "critico", "tipo": "temperatura",
  "mensagem": "Sala 1: temperatura 28.4C fora da faixa (20-26C)",
  "salaId": "sala-1", "ts": "2026-06-25T20:11:00.000Z", "reconhecido": false
}
```
`level` ∈ `"critico" | "atencao" | "info"`. `tipo` ∈ `temperatura | umidade | co2 | vav | incendio`.

---

## 2. Endpoints REST (Backend → Dashboard)

Base URL: `/api` (configurável via `VITE_API_BASE`).

| Método | Rota | Descrição | RF |
|--------|------|-----------|----|
| GET | `/api/estado` | Estado completo (salas, climatizadores, banheiros, exaustão, conexão) | RF04, RF07 |
| GET | `/api/historico/:salaId/:metrica` | Série temporal (`metrica` = `temperatura`\|`umidade`\|`co2`) | RNF07 |
| GET | `/api/parametros` | Mapa de faixas de alerta por sala | RNF06 |
| PUT | `/api/parametros/:salaId` | Atualiza as faixas de **uma** sala | RNF06 |
| GET | `/api/alertas` | Lista de alertas | RF12-RF16 |
| POST | `/api/alertas/:id/reconhecer` | Marca alerta como reconhecido | — |
| DELETE | `/api/alertas/reconhecidos` | Remove alertas reconhecidos | — |
| PUT | `/api/salas/:salaId/vav/modo` | `{ "modo": "auto"\|"manual" }` — modo de operação da VAV | RF06 |
| PUT | `/api/salas/:salaId/vav` | `{ "abertura": 0-100 }` — override manual (força `modo:manual`) | RF06, RF08 |
| PUT | `/api/climatizadores/:id` | `{ "ligado": bool, "setpoint": number }` | RF05, RF08 |
| PUT | `/api/banheiros/:id` | `{ "luz": bool }` — dispara intertravamento OR | RF10/RF11 |
| GET / PUT | `/api/ntfy` | Configuração de notificações | RF17 |
| GET | `/api/ntfy/log` | Histórico de notificações enviadas | RF17 |

### Exemplo — `GET /api/estado`
```json
{
  "timestamp": "2026-06-25T20:10:00.000Z",
  "conexao": { "online": true, "fonte": "MQTT" },
  "salas": [ /* Sala[] */ ],
  "climatizadores": [ /* Climatizador[] */ ],
  "banheiros": [ /* Banheiro[] */ ],
  "exaustao": { "ligada": false, "logica": "OR" }
}
```

---

## 3. Endpoints REST (Arduino → Backend) — caminho redundante

| Método | Rota | Corpo |
|--------|------|-------|
| POST | `/api/telemetria` | `{ "salaId": "sala-1", "temperatura": 22.6, "umidade": 51, "co2": 720 }` |
| POST | `/api/vav/estado` | `{ "salaId": "sala-1", "abertura": 60, "estado": "ok" }` |
| POST | `/api/banheiro/luz` | `{ "banheiroId": "ban-1", "luz": true }` |

Resposta: `200 { "ok": true }`. Recomenda-se header `X-Device-Token` para autenticação simples.

---

## 4. Tópicos MQTT (caminho principal)

Broker sugerido: Mosquitto. Formato de payload: JSON.

**Publicações do Arduino (telemetria/estado):**

| Tópico | Payload | Frequência |
|--------|---------|-----------|
| `hvac/sala/1/telemetria` | `{ "temperatura": 22.6, "umidade": 51, "co2": 720 }` | a cada 3-5 s |
| `hvac/sala/1/vav` | `{ "abertura": 60, "estado": "ok" }` | em mudança |
| `hvac/banheiro/1/luz` | `{ "luz": true }` | em mudança |
| `hvac/status` | `{ "online": true }` (LWT recomendado) | conexão |

**Comandos do Backend → Arduino (subscribe no ESP32):**

| Tópico | Payload |
|--------|---------|
| `hvac/sala/1/vav/set` | `{ "abertura": 40 }` |
| `hvac/clima/1/set` | `{ "ligado": true, "setpoint": 23 }` |

> O backend assina `hvac/#`, atualiza o estado em memória + SQLite, reavalia os parâmetros
> e republica comandos quando a dashboard chama os endpoints `PUT`.

### 4.1 Controle automático da VAV (essência da automação)

A VAV **modula sozinha** — ninguém define a abertura manualmente em operação normal.
A malha de controle (no ESP32, ou no backend que comanda o ESP32) calcula a abertura a
partir de duas demandas, usando a maior delas:

- **Resfriamento:** proporcional ao erro `temperatura − setpoint do climatizador`.
  Quanto mais quente que o alvo, mais a VAV abre.
- **Ventilação:** proporcional ao **CO₂**. Acima do limite de atenção a VAV abre para
  renovar o ar; no limite crítico vai a 100%.

`abertura_alvo = max(demanda_resfriamento, demanda_ventilacao)`, com movimento suave do
atuador. O operador pode assumir o controle (`modo: manual`) via dashboard/endpoint, e
voltar para `auto` quando quiser. A dashboard apenas **exibe** a abertura e o motivo em
modo automático.

---

## 5. Integração ntfy.sh (RF17)

Ao detectar um alerta com `level >= minLevel`, o backend faz:

```
POST https://ntfy.sh/<topic>
Headers:
  Title:    HVAC - ALARME CRITICO
  Priority: urgent        # urgent (critico) | high (atencao)
  Tags:     rotating_light
Body:
  Sala 1: temperatura 28.4C fora da faixa (20-26C)
```

Exemplo de implementação (Node):
```js
await fetch(`https://ntfy.sh/${topic}`, {
  method: "POST",
  headers: { Title: title, Priority: priority, Tags: tags.join(",") },
  body: mensagem,
});
```

Para receber no celular: instale o app **ntfy** e assine o tópico configurado em
*Parâmetros → Notificações ntfy.sh*.

---

## 6. Persistência — SQLite

```sql
CREATE TABLE leituras (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sala_id   TEXT NOT NULL,
  temperatura REAL,
  umidade   REAL,
  co2       REAL,
  ts        TEXT NOT NULL          -- ISO 8601
);
CREATE INDEX idx_leituras_sala_ts ON leituras (sala_id, ts);

CREATE TABLE alertas (
  id          TEXT PRIMARY KEY,
  level       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  mensagem    TEXT NOT NULL,
  sala_id     TEXT,
  ts          TEXT NOT NULL,
  reconhecido INTEGER DEFAULT 0
);

CREATE TABLE parametros (        -- uma linha por sala
  sala_id  TEXT PRIMARY KEY,
  temp_min REAL, temp_max REAL,
  umi_min  REAL, umi_max  REAL,
  co2_warn REAL, co2_critical REAL
);

CREATE TABLE eventos (           -- log mínimo de operação (RNF07)
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT, descricao TEXT, ts TEXT NOT NULL
);
```

---

## 7. Mapeamento Requisito → Implementação

| Requisito | Onde |
|-----------|------|
| RF01-RF03 leitura de temp/umidade/CO₂ | MQTT `hvac/sala/+/telemetria` + `POST /api/telemetria` |
| RF04 exibir valores | `GET /api/estado` → cards na dashboard |
| RF05 vínculo climatizador↔salas | campo `salas[]` do climatizador |
| RF06/RF07 controle e estado da VAV | controle **automático** (seção 4.1) + override `modo:manual`; `vav.estado` |
| RF08/RF09 comandos e dados via API | seções 2 e 3 |
| RF10/RF11 exaustão lógica OR | `exaustao.ligada`, `PUT /api/banheiros/:id` |
| RF12-RF16 alertas | seção 1 (Alerta) + avaliação por parâmetros |
| RF17 ntfy.sh | seção 5 |
| RF18 BACnet | *(o levantamento cita BACnet; este projeto adota MQTT conforme decisão do aluno — registrar a troca no TCC)* |
| RNF06 faixas configuráveis | `/api/parametros` + tela Parâmetros |
| RNF07 logs | tabelas `eventos`/`leituras` |
