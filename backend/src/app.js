// ---------------------------------------------------------------------------
// Monta a aplicacao Express (sem app.listen - quem escuta e o server.js, o
// que permite aos testes subirem a API numa porta aleatoria).
//
// A ORDEM dos middlewares e parte da seguranca:
//   1. endurecimento (helmet, CORS, sem X-Powered-By)
//   2. anti-bot (scanners, rate limit) e limite de corpo
//   3. rotas publicas (health, login) e do ESP32 (telemetria)
//   4. autenticacao obrigatoria (JWT)
//   5. escrita exige papel >= operator
//   6. rotas protegidas (usuarios, salas, alertas, CRUD)
//   7. 404 e tratamento de erros sem stack trace
// ---------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import helmet from "helmet";

import { criarAuth } from "./seguranca/auth.js";
import { bloquearScanners, criarLimitadores } from "./seguranca/antiBot.js";
import { rotaNaoEncontrada, tratarErros } from "./middlewares/comuns.js";

import { rotasPublicas } from "./rotas/publicas.js";
import { rotasTelemetria } from "./rotas/telemetria.js";
import { rotasConta, rotasUsuarios } from "./rotas/usuarios.js";
import { rotasSalas } from "./rotas/salas.js";
import { rotasAlertas } from "./rotas/alertas.js";
import { rotasCrud } from "./rotas/crud.js";

export function createApp(config) {
  const app = express();
  const { emitirToken, autenticar, exigir, autenticarDispositivo } = criarAuth(config);
  const limitadores = criarLimitadores(config.rateLimit);
  const deps = { config, limitadores, emitirToken, exigir, autenticarDispositivo };

  // 1. Endurecimento basico
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy || false); // nao confia em X-Forwarded-For por padrao
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins, // allowlist; [] => nenhuma origem cross-site
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Device-Token"],
    })
  );

  // 2. Anti-bot e limite de corpo
  app.use("/api", bloquearScanners);
  app.use("/api", limitadores.api);
  app.use(express.json({ limit: "20kb" })); // corpo gigante => 413

  // 3. Rotas sem login de usuario
  app.use("/api", rotasPublicas(deps));
  app.use("/api", rotasTelemetria(deps));

  // 4. Daqui para baixo: exige usuario autenticado
  app.use("/api", autenticar);
  app.use("/api", rotasConta()); // troca da propria senha (vale ate para viewer)

  // 5. Qualquer escrita exige no minimo "operator" (viewer so le)
  app.use("/api", (req, res, next) => (req.method === "GET" ? next() : exigir("operator")(req, res, next)));

  // 6. Rotas protegidas
  app.use("/api", rotasUsuarios(deps));
  app.use("/api", rotasSalas(deps));
  app.use("/api", rotasAlertas());
  app.use("/api", rotasCrud(deps));

  // 7. 404 e erros
  app.use("/api", rotaNaoEncontrada);
  app.use(tratarErros);

  return app;
}
