# Backend HVAC — Node + SQLite (conforme a DER)

Backend do TCC: banco **SQLite** modelado **100% conforme a DER** (7 entidades) e uma
**API REST** (Express) sobre elas, com **ingestão de leituras**, **avaliação de limites →
alertas**, **ponte MQTT** (recebe os dados do ESP32) e **ntfy.sh**.

## Requisitos
- Node.js 18+ (testado com Node 22).

## Como rodar
```bash
cd backend
npm install
npm start
```
- O arquivo do banco **`hvac.db` é criado automaticamente** na primeira execução, com as
  tabelas da DER e um *seed* inicial (2 climatizadores, 4 salas, 4 VAVs, sensores e limites).
- A API sobe em `http://localhost:3001`.
- A ponte MQTT assina o tópico do ESP e grava as leituras (configure em `.env`).

Para configurar broker/tópico/sala e ntfy, copie `.env.example` para `.env` e ajuste.

## Modelo de dados (DER)
Tabelas: `CLIMATIZADOR`, `SALA`, `VAV`, `SENSOR`, `LIMITE_ALERTA`, `ALERTA`, `LEITURA_SENSOR`
(ver `schema.sql`). Fidelidade à DER: os nomes `stauts` (CLIMATIZADOR) e `qualidade-leitura`
(LEITURA_SENSOR) foram mantidos exatamente como na DER.

## Endpoints
CRUD para cada entidade (`GET` lista, `GET/:id`, `POST`, `PUT/:id`, `DELETE/:id`):

| Recurso | Rota base |
|---|---|
| Climatizadores | `/api/climatizadores` |
| Salas | `/api/salas` |
| VAVs | `/api/vavs` |
| Sensores | `/api/sensores` |
| Limites de alerta | `/api/limites` |
| Alertas | `/api/alertas` |
| Leituras | `/api/leituras` |

Auxiliares:
- `GET /api/salas/:id/sensores` — sensores de uma sala
- `GET /api/sensores/:id/leituras` — histórico de um sensor
- `POST /api/telemetria` — grava leitura e avalia alertas
  `body: { "id_sensor": 1, "valor": 24.3, "qualidade": "boa" }`
- `GET /api/health`

## Fluxo com o ESP32
```
ESP32 --(MQTT)--> broker --(mqttBridge)--> LEITURA_SENSOR (SQLite)
                                        --> avalia LIMITE_ALERTA --> ALERTA + ntfy.sh
```
O `mqttBridge` mapeia o JSON do ESP (`temperature`, `humidity`, `co2`) para os SENSORES da
sala configurada (`SALA_ID`), por `tipo` (`temperatura`, `umidade`, `co2`).

## Observações
- `better-sqlite3` é um módulo nativo; o `npm install` compila/baixa o binário
  automaticamente. Se necessário, tenha as ferramentas de build do seu SO.
- Para ligar a dashboard React a este backend, será preciso um pequeno adaptador (as
  respostas aqui seguem a DER normalizada). Posso implementar quando quiser.
