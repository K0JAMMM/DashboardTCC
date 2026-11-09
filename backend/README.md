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
cp .env.example .env   # preencha JWT_SECRET e ADMIN_SENHA (o backend recusa subir sem eles)
npm start
```
- Login no dashboard com `ADMIN_LOGIN`/`ADMIN_SENHA` do `.env`. Outros usuários:
  `NOVA_SENHA='<senha forte>' npm run criar-usuario -- operador1 operator 1,2`
- Token para o ESP32: `npm run criar-dispositivo -- "ESP32 Sala 1" 1` (enviar no cabeçalho `X-Device-Token`).

## Testes de segurança
```bash
npm test   # IDOR, Criptografia/Senhas, Injeção e Bots (124 testes)
```
Detalhes e roteiro de apresentação em [`../docs/TESTES_SEGURANCA.md`](../docs/TESTES_SEGURANCA.md).
- O arquivo do banco **`hvac.db` é criado automaticamente** na primeira execução, com as
  tabelas da DER e um *seed* inicial (2 climatizadores, 4 salas, 4 VAVs, sensores e limites).
- A API sobe em `http://localhost:3001`.
- A ponte MQTT assina o tópico do ESP e grava as leituras (configure em `.env`).

Para configurar broker/tópico/sala e ntfy, copie `.env.example` para `.env` e ajuste.

## Estrutura
```
backend/
├── server.js                 ponto de entrada (config, admin inicial, listen, MQTT)
├── src/
│   ├── app.js                monta o Express: ordem dos middlewares e das rotas
│   ├── config.js             leitura do .env com falha na inicializacao
│   ├── banco/                db.js (conexao, migracao, seed) e schema.sql
│   ├── seguranca/            auth (JWT, papeis, posse), senha (scrypt), validacao (zod), antiBot
│   ├── middlewares/          validacao de ids, 404 e tratamento de erros
│   ├── rotas/                publicas, telemetria, usuarios, salas, alertas, crud
│   ├── servicos/             regras de negocio: acoes, estado, leituras, provisionamento, usuarios
│   └── integracoes/          mqtt (ESP32) e ntfy (notificacoes)
├── scripts/                  criar-usuario, criar-dispositivo
├── test/                     testes de seguranca (IDOR, senhas, injecao, bots)
└── hvac.db                   banco SQLite (criado na 1a execucao, fora do git)
```

## Modelo de dados (DER)
Tabelas: `CLIMATIZADOR`, `SALA`, `VAV`, `SENSOR`, `LIMITE_ALERTA`, `ALERTA`, `LEITURA_SENSOR`
(ver `src/banco/schema.sql`). Fidelidade à DER: os nomes `stauts` (CLIMATIZADOR) e `qualidade-leitura`
(LEITURA_SENSOR) foram mantidos exatamente como na DER.

## Endpoints
Todas as rotas exigem `Authorization: Bearer <token>` (obtido em `POST /api/login`), exceto
`GET /api/health`, `POST /api/login` e `POST /api/telemetria` (que usa `X-Device-Token`).
Escrita genérica é só para admin e por allowlist; leituras e alertas não podem ser apagados.

Leitura para cada entidade (`GET` lista paginada com `?limit=&offset=`, `GET /:id`):

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
- `POST /api/telemetria` — grava leitura e avalia alertas (cabeçalho `X-Device-Token`)
  `body: { "id_sensor": 1, "valor": 24.3, "qualidade": "boa" }`
- `POST /api/login` — `{ login, senha }` → `{ token, usuario }`
- `GET /api/usuarios/me`, `POST /api/usuarios` (admin), `PUT /api/usuarios/:id/senha`
- `POST /api/dispositivos` (admin) — `{ nome, idSala }` → token do ESP32 (exibido uma vez)
- `GET /api/health`

## Fluxo com o ESP32
```
ESP32 --(MQTT)--> broker --(integracoes/mqtt.js)--> LEITURA_SENSOR (SQLite)
                                        --> avalia LIMITE_ALERTA --> ALERTA + ntfy.sh
```
A ponte MQTT (`src/integracoes/mqtt.js`) mapeia o JSON do ESP (`temperature`, `humidity`, `co2`) para os SENSORES da
sala configurada (`SALA_ID`), por `tipo` (`temperatura`, `umidade`, `co2`).

## Observações
- `better-sqlite3` é um módulo nativo; o `npm install` compila/baixa o binário
  automaticamente. Se necessário, tenha as ferramentas de build do seu SO.
- Para ligar a dashboard React a este backend, será preciso um pequeno adaptador (as
  respostas aqui seguem a DER normalizada). Posso implementar quando quiser.
