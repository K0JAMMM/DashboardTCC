// ---------------------------------------------------------------------------
// Protecao contra BOTS: bloqueio de scanners e limites de requisicao.
// (O bloqueio de conta por senha errada fica em servicos/usuarios.js e o
//  honeypot do login em rotas/publicas.js.)
// ---------------------------------------------------------------------------

import { rateLimit } from "express-rate-limit";

// User-Agents de ferramentas de ataque/varredura automatizada.
const UA_BLOQUEADOS =
  /(sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|ffuf|wfuzz|wpscan|nuclei|acunetix|nessus|openvas|hydra|medusa|havij|commix|xsstrike)/i;

// Recusa scanners conhecidos e clientes sem User-Agent.
export function bloquearScanners(req, res, next) {
  const ua = req.get("user-agent") || "";
  if (!ua.trim() || UA_BLOQUEADOS.test(ua)) return res.status(403).json({ erro: "cliente bloqueado" });
  next();
}

// Cria os limitadores a partir de config.rateLimit.
// Sem proxy confiavel, X-Forwarded-For e IGNORADO de proposito (o bot nao
// escolhe o proprio IP); `validate` so desliga o aviso da biblioteca sobre isso.
export function criarLimitadores(rl) {
  const comum = { standardHeaders: "draft-7", legacyHeaders: false, validate: { xForwardedForHeader: false } };
  return {
    // Limite global por IP em toda a /api.
    api: rateLimit({
      ...comum,
      windowMs: rl.janelaMs,
      limit: rl.maxApi,
      message: { erro: "muitas requisicoes, tente novamente mais tarde" },
    }),
    // Tentativas de login por IP (forca bruta).
    login: rateLimit({
      ...comum,
      windowMs: rl.loginJanelaMs,
      limit: rl.maxLogin,
      message: { erro: "muitas tentativas de login, aguarde" },
    }),
    // Leituras por DISPOSITIVO (precisa vir depois de autenticarDispositivo).
    telemetria: rateLimit({
      ...comum,
      windowMs: rl.janelaMs,
      limit: rl.maxTelemetria,
      keyGenerator: (req) => `disp-${req.dispositivo.id_dispositivo}`,
      message: { erro: "muitas leituras deste dispositivo" },
    }),
  };
}
