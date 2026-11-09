// ---------------------------------------------------------------------------
// Regras de negocio das leituras: inserir LEITURA_SENSOR, avaliar
// LIMITE_ALERTA e gerar ALERTA (+ notificacao ntfy).
// ---------------------------------------------------------------------------

import { db } from "../banco/db.js";
import { FAIXA_FISICA } from "../seguranca/validacao.js";
import { enviarNtfy } from "../integracoes/ntfy.js";

// Insere uma LEITURA_SENSOR e avalia os limites da sala do sensor.
// Valida tipo e faixa fisica aqui para valer tanto no caminho REST quanto no MQTT.
export function inserirLeitura({ id_sensor, valor, qualidade = null }) {
  if (!Number.isInteger(id_sensor)) return { ok: false, erro: "id_sensor invalido" };
  if (typeof valor !== "number" || !Number.isFinite(valor)) return { ok: false, erro: "valor deve ser numero finito" };
  const sensor = db.prepare("SELECT * FROM SENSOR WHERE id_sensor = ?").get(id_sensor);
  if (!sensor) return { ok: false, erro: "sensor inexistente" };
  const faixa = FAIXA_FISICA[sensor.tipo];
  if (faixa && (valor < faixa[0] || valor > faixa[1])) {
    console.warn(`Leitura descartada: sensor ${id_sensor} (${sensor.tipo}) = ${valor} fora da faixa fisica`);
    return { ok: false, erro: "valor fora da faixa fisica do sensor" };
  }

  const data_hora = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO LEITURA_SENSOR (valor, data_hora, "qualidade-leitura", id_sensor) VALUES (?, ?, ?, ?)')
    .run(valor, data_hora, qualidade, id_sensor);

  avaliarLimites(sensor, valor, data_hora);
  return { ok: true, id_leitura: info.lastInsertRowid };
}

// Compara a leitura com o LIMITE_ALERTA (mesma sala + mesmo tipo do sensor).
function avaliarLimites(sensor, valor, data_hora) {
  const lim = db
    .prepare("SELECT * FROM LIMITE_ALERTA WHERE id_sala = ? AND tipo = ?")
    .get(sensor.id_sala, sensor.tipo);
  if (!lim) return;

  const forcaMin = lim.valor_min != null && valor < lim.valor_min;
  const forcaMax = lim.valor_max != null && valor > lim.valor_max;
  if (!forcaMin && !forcaMax) return;

  // evita duplicar: nao cria novo alerta identico aberto nos ultimos 60s
  const recente = db
    .prepare(
      "SELECT 1 FROM ALERTA WHERE id_sensor = ? AND tipo = ? AND data_hora >= ? LIMIT 1"
    )
    .get(sensor.id_sensor, sensor.tipo, new Date(Date.now() - 60000).toISOString());
  if (recente) return;

  const sala = db.prepare("SELECT * FROM SALA WHERE id_sala = ?").get(sensor.id_sala);
  const nivel = "critico";
  const mensagem = `${sala?.nome || "Sala " + sensor.id_sala}: ${sensor.tipo} = ${valor}${sensor.unidade || ""} fora da faixa (${lim.valor_min} a ${lim.valor_max})`;

  db.prepare(
    "INSERT INTO ALERTA (tipo, mensagem, nivel, data_hora, id_sala, id_sensor) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(sensor.tipo, mensagem, nivel, data_hora, sensor.id_sala, sensor.id_sensor);

  enviarNtfy(nivel, mensagem);
}
