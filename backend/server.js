// ---------------------------------------------------------------------------
// Ponto de entrada: carrega a configuracao (fail-fast), cria o primeiro admin
// se configurado, sobe a API e a ponte MQTT. O codigo da API fica em src/.
// ---------------------------------------------------------------------------

import { carregarConfig } from "./src/config.js";

// Valida a configuracao ANTES de abrir o banco ou qualquer porta.
let config;
try {
  config = carregarConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const { createApp } = await import("./src/app.js");
const { configurarNtfy } = await import("./src/integracoes/ntfy.js");
const { startMqtt } = await import("./src/integracoes/mqtt.js");
const { buscarUsuarioPorLogin, criarUsuario } = await import("./src/servicos/usuarios.js");

// Primeiro administrador: credenciais vem do .env (ADMIN_LOGIN/ADMIN_SENHA),
// nunca do codigo. So cria se ainda nao existir.
if (config.adminInicial && !buscarUsuarioPorLogin(config.adminInicial.login)) {
  const r = await criarUsuario({ ...config.adminInicial, papel: "admin" });
  if (!r.ok) {
    console.error(`Nao foi possivel criar o admin inicial: ${r.erro} ${(r.detalhes || []).join(", ")}`);
    process.exit(1);
  }
  console.log(`Admin inicial "${config.adminInicial.login}" criado.`);
}

configurarNtfy(config.ntfy);
const app = createApp(config);

app.listen(config.port, config.host, () => {
  console.log(`Backend HVAC ouvindo em http://${config.host}:${config.port}`);
  startMqtt(config.mqtt);
});
