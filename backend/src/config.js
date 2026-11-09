// ---------------------------------------------------------------------------
// Configuracao centralizada com falha na inicializacao (fail-fast).
//
// Todas as variaveis de ambiente sao lidas aqui. Se um segredo obrigatorio
// estiver ausente, curto demais ou igual a um valor padrao/publico, o backend
// RECUSA subir - assim um "default" nunca vira segredo de producao sem que
// ninguem perceba.
// ---------------------------------------------------------------------------

// Valores que nunca podem ser usados como segredo (padroes conhecidos/publicos).
export const SEGREDOS_PROIBIDOS = new Set([
  "change-me", "changeme", "secret", "segredo", "password", "senha", "123456",
  "jwt-secret", "your-secret", "minha-chave-secreta",
]);

function inteiro(valor, padrao) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : padrao;
}

export function carregarConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET || "";
  if (jwtSecret.length < 32 || SEGREDOS_PROIBIDOS.has(jwtSecret.toLowerCase())) {
    throw new Error(
      "Configuracao invalida: JWT_SECRET ausente, curto (< 32 caracteres) ou igual a um valor padrao. " +
        "Gere um com: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }

  const producao = env.NODE_ENV === "production";

  return {
    producao,
    port: inteiro(env.PORT, 3001),
    // Por padrao escuta so em localhost (nunca 0.0.0.0 sem pedir explicitamente).
    host: env.HOST || "127.0.0.1",
    // Allowlist de origens CORS. Vazio = nenhuma origem cross-site aceita.
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    // Numero de proxies reversos confiaveis. 0 = ignora X-Forwarded-For
    // (impede que um bot "troque de IP" so mudando o cabecalho).
    trustProxy: inteiro(env.TRUST_PROXY, 0),

    jwtSecret,
    jwtExpiraEm: env.JWT_EXPIRES_IN || "8h",

    // ---- Protecao contra bots / forca bruta ----
    rateLimit: {
      janelaMs: inteiro(env.RATE_LIMIT_WINDOW_MS, 60_000),
      maxApi: inteiro(env.RATE_LIMIT_MAX, 300), // req/janela por IP em /api
      loginJanelaMs: inteiro(env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
      maxLogin: inteiro(env.LOGIN_RATE_LIMIT_MAX, 10), // tentativas de login/janela por IP
      maxTelemetria: inteiro(env.TELEMETRIA_RATE_LIMIT_MAX, 120), // leituras/janela por dispositivo
    },
    bloqueio: {
      maxFalhas: inteiro(env.LOGIN_MAX_FALHAS, 5), // falhas seguidas ate bloquear a conta
      duracaoMs: inteiro(env.LOGIN_BLOQUEIO_MS, 15 * 60_000),
    },

    // ---- MQTT (opcional; sem MQTT_URL a ponte nao sobe) ----
    mqtt: env.MQTT_URL
      ? {
          url: env.MQTT_URL,
          topic: env.MQTT_TOPIC || "",
          username: env.MQTT_USERNAME || undefined,
          password: env.MQTT_PASSWORD || undefined,
          salaId: inteiro(env.SALA_ID, 1),
        }
      : null,

    // ---- ntfy.sh (opcional) ----
    ntfy:
      env.NTFY_ENABLED === "true" && env.NTFY_SERVER && env.NTFY_TOPIC
        ? { ativo: true, server: env.NTFY_SERVER, topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN || null }
        : { ativo: false },

    // ---- Primeiro administrador (bootstrap, sem senha no codigo) ----
    adminInicial:
      env.ADMIN_LOGIN && env.ADMIN_SENHA ? { login: env.ADMIN_LOGIN, senha: env.ADMIN_SENHA } : null,
  };
}
