# Testes de segurança — Dashboard HVAC (TCC)

Testes automatizados que **atacam o próprio código-fonte** do backend e verificam que cada
falha trabalhada está corrigida. São **124 testes** em 4 categorias, escritos com o
test runner nativo do Node (`node --test`), sem dependência extra.

Cada arquivo sobe a API de verdade (Express) numa porta aleatória de `127.0.0.1`, com um
banco SQLite **temporário** (o `hvac.db` de desenvolvimento nunca é tocado), e faz
requisições HTTP reais — exatamente o que um atacante faria.

| Categoria | Arquivo | Testes | O que é atacado |
|---|---|---|---|
| IDOR | `backend/test/idor.test.js` | 32 | Trocar o ID na URL/corpo para ler ou comandar sala, alerta, usuário ou sensor de outra pessoa |
| Criptografia/Senhas | `backend/test/criptografia-senhas.test.js` | 31 | Senha em texto puro, hash fraco, senha fraca, vazamento de hash, JWT forjado/adulterado/expirado, segredo fraco |
| Injeção de código | `backend/test/injecao.test.js` | 42 | SQL injection (login, URL, query, corpo), injeção de tipo/operador, prototype pollution, XSS, fórmula em CSV, eval/exec, stack trace |
| Bots | `backend/test/bots.test.js` | 19 | Força bruta, credential stuffing, flood, troca de IP via `X-Forwarded-For`, scanners (sqlmap, nikto…), honeypot, corpo gigante |

---

## Como rodar (apresentação)

Requer **Node.js 20.6+** (testado em 20 e 22).

```powershell
cd backend
npm install
npm test               # as 4 categorias (124 testes, ~6 s)
```

Ou uma categoria por vez:

```powershell
npm run test:idor
npm run test:senhas
npm run test:injecao
npm run test:bots
```

Saída esperada no final: `ℹ pass 124` e `ℹ fail 0`.

### Prova de que os testes pegam a falha (opcional, ao vivo)

Desligue uma proteção e rode de novo — os testes ficam vermelhos. Exemplo em
`backend/src/seguranca/auth.js`, na função `exigirPosseSala`, troque

```js
if (!podeComandarSala(req.usuario, idSala)) {
```
por
```js
if (false) {
```

e rode `npm run test:idor`: os testes "operador1 troca o ID para a sala 3…" falham, porque o
operador passa a conseguir comandar sala de outro. Desfaça a alteração e tudo volta a passar.

---

## O que foi implementado para cada falha

Caminhos relativos a `backend/` (exceto onde indicado frontend).

### 1. IDOR (Insecure Direct Object Reference)

| Defesa | Onde |
|---|---|
| Todas as rotas (exceto `health`, `login` e `telemetria`) exigem JWT | `src/app.js` → `app.use("/api", autenticar)` |
| Papéis: `viewer` só lê, `operator` comanda, `admin` administra | `src/seguranca/auth.js` → `exigir()` |
| **Posse por objeto:** operador só comanda as salas dele (`USUARIO_SALA`) | `src/seguranca/auth.js` → `exigirPosseSala`, `podeComandarSala`, `podeComandarClimatizador` |
| Alertas: só reconhece/arquiva alertas das próprias salas; "quem reconheceu" vem do token | `src/rotas/alertas.js`, `src/servicos/acoes.js` |
| Perfil de outro usuário responde **404** (não revela que existe) | `src/rotas/usuarios.js` |
| ESP32 tem token próprio e só grava sensores **da sala dele** | `src/rotas/telemetria.js` |
| Mass assignment: escrita genérica só por allowlist, sem chaves estrangeiras | `src/seguranca/validacao.js` → `crudSchemas`, `src/rotas/crud.js` |
| Leituras e alertas não podem ser apagados (sem rota DELETE + trigger no SQLite) | `src/banco/schema.sql` |

### 2. Criptografia / Senhas

| Defesa | Onde |
|---|---|
| Senha com **scrypt** (KDF lenta) + salt aleatório de 16 bytes; nunca em texto puro | `src/seguranca/senha.js` |
| Comparação em tempo constante (`timingSafeEqual`) e hash falso para login inexistente | `src/seguranca/senha.js`, `src/rotas/publicas.js` |
| Política de senha forte (12+, maiúscula, minúscula, número, símbolo, não comum, sem o login) | `src/seguranca/senha.js` → `validarPoliticaSenha` |
| `senha_hash` nunca sai em nenhuma resposta | `src/servicos/usuarios.js` → `paraUsuarioPublico` |
| JWT com algoritmo **fixo HS256** (bloqueia `alg:none`), expiração e papel lido do banco | `src/seguranca/auth.js` |
| `JWT_SECRET` obrigatório, ≥ 32 caracteres e diferente de valores padrão (fail-fast) | `src/config.js` |
| Token do ESP32 com 256 bits aleatórios; no banco só o SHA-256 | `src/seguranca/senha.js`, `src/servicos/usuarios.js` |
| Cabeçalhos de segurança (HSTS etc.) via `helmet` | `src/app.js` |

### 3. Injeção de código

| Defesa | Onde |
|---|---|
| Todas as queries parametrizadas (`?`) no better-sqlite3 | `src/banco`, `src/servicos`, `src/rotas` |
| Todo `:id`/`:salaId` precisa ser inteiro positivo (senão 400) | `src/middlewares/comuns.js` → `validarIds` |
| Schemas **zod estritos**: tipo exato, faixa, chave desconhecida → 400 (bloqueia `{"$ne":null}`, `__proto__`, colunas forjadas) | `src/seguranca/validacao.js` |
| Textos com allowlist de caracteres (bloqueia `<script>`, aspas, `;`) | `src/seguranca/validacao.js` → `textoSeguro` |
| Leituras fora da faixa física descartadas (sem alerta falso) | `src/servicos/leituras.js` |
| Exportação CSV neutraliza fórmulas (`= + - @`) | `src/utils/csv.js` |
| Erros sem stack trace nem SQL; respostas JSON com `nosniff` e CSP | `src/middlewares/comuns.js`, `src/app.js` |

### 4. Bots

| Defesa | Onde |
|---|---|
| Rate limit global por IP na API (padrão 300/min) | `src/seguranca/antiBot.js` |
| Rate limit no login por IP (padrão 10 a cada 15 min) | `src/seguranca/antiBot.js` |
| **Bloqueio de conta** após 5 senhas erradas seguidas (15 min), persistido no banco | `src/servicos/usuarios.js` |
| `X-Forwarded-For` ignorado (o bot não escolhe o próprio IP) — `TRUST_PROXY` só atrás de proxy real | `src/config.js`, `src/app.js` |
| Rate limit por dispositivo na telemetria | `src/seguranca/antiBot.js` |
| Bloqueio de User-Agent de scanners e de requisições sem User-Agent | `src/seguranca/antiBot.js` |
| **Honeypot** `website` invisível no formulário de login | `src/pages/LoginPage.jsx` (frontend), `src/rotas/publicas.js` |
| Corpo limitado a 20 KB (413) | `src/app.js` |

---

## CI/CD (GitHub Actions)

| Arquivo | Quando roda | O que faz |
|---|---|---|
| `.github/workflows/security-tests.yml` | **Todo Pull Request** (e manualmente) | Roda as 4 categorias em Node 20 e 22, publica tabela de resultados no resumo do PR e relatórios JUnit, faz `npm audit` e build do frontend. Teste falhou → check vermelho no PR. |
| `.github/workflows/deploy.yml` | **Push/merge na `main`** (e manualmente) | Reexecuta os testes de segurança como portão; se passarem, publica a imagem Docker do backend no GHCR, opcionalmente dispara o deploy do servidor e publica o dashboard no GitHub Pages. |

Configuração única no repositório:

1. **Settings → Pages → Source: GitHub Actions** (para o deploy do frontend).
2. (Opcional) **Settings → Secrets → Actions → `RENDER_DEPLOY_HOOK_URL`**: URL de deploy hook do
   Render (ou outro host) apontando para a imagem `ghcr.io/<dono>/hvac-backend:latest`, com as
   variáveis `JWT_SECRET`, `ADMIN_LOGIN` e `ADMIN_SENHA` configuradas no painel do host.

> O GitHub Pages hospeda só arquivos estáticos, então o dashboard publicado roda em modo
> demonstração (dados simulados). O backend real roda a partir da imagem Docker.
