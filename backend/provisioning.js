// ---------------------------------------------------------------------------
// Camada de PROVISIONAMENTO (framework, parte 1 - camadas).
//
// Problema que resolve: hoje, para colocar uma sala nova no ar, era preciso
// fazer 4 chamadas manuais na ordem certa (SALA -> VAV -> SENSOR x N ->
// LIMITE_ALERTA x N), respeitando as chaves estrangeiras da DER. Essa funcao
// concentra isso em UMA chamada, dentro de uma unica transacao (tudo ou
// nada): se qualquer insercao falhar, nada e gravado.
//
// Ela nao cria "codigo" nenhum - so grava dados seguindo o schema. E por
// causa disso que a sala aparece automaticamente na API (crud generico) e no
// dashboard (GET /api/estado, ver estado.js) sem precisar tocar em nenhum
// componente React.
// ---------------------------------------------------------------------------

import { db } from "./db.js";

// Conjunto padrao de sensores/limites (mesmos defaults usados no seed(),
// alinhados a ABNT NBR 7256 / ANVISA RE 09/2003 - ver docs/CONFORMIDADE.md).
const SENSORES_PADRAO = [
  { tipo: "temperatura", unidade: "C", limite: { min: 20, max: 26 } },
  { tipo: "umidade", unidade: "%", limite: { min: 40, max: 60 } },
  { tipo: "co2", unidade: "ppm", limite: { min: 0, max: 1000 } },
];

/**
 * Cria uma sala completa: SALA + VAV (1:1) + SENSOR (N) + LIMITE_ALERTA (N).
 *
 * @param {object} p
 * @param {string} p.nome                  - nome da sala (obrigatorio)
 * @param {string} [p.andar]
 * @param {number} p.idClimatizador        - climatizador ao qual a sala pertence (obrigatorio, precisa existir)
 * @param {number} [p.setpoint=23]         - alvo de temperatura da sala
 * @param {object} [p.vav]                 - { abertura?, vazaoAr? } - estado inicial da VAV
 * @param {Array}  [p.sensores]            - [{ tipo, unidade, limite:{min,max} }, ...]
 *                                           se omitido, usa SENSORES_PADRAO (temperatura/umidade/co2)
 * @returns {{ok:boolean, id_sala?:number, erro?:string}}
 */
export function criarSalaCompleta({
  nome,
  andar = null,
  idClimatizador,
  setpoint = 23,
  vav = {},
  sensores,
} = {}) {
  if (!nome || !nome.trim()) return { ok: false, erro: "nome da sala e obrigatorio" };
  if (!idClimatizador) return { ok: false, erro: "idClimatizador e obrigatorio" };

  const clima = db
    .prepare("SELECT * FROM CLIMATIZADOR WHERE id_climatizador = ?")
    .get(idClimatizador);
  if (!clima) return { ok: false, erro: `climatizador ${idClimatizador} nao existe` };

  const listaSensores = sensores?.length ? sensores : SENSORES_PADRAO;
  for (const s of listaSensores) {
    if (!s.tipo) return { ok: false, erro: "todo sensor precisa de 'tipo'" };
  }

  const insSala = db.prepare(
    "INSERT INTO SALA (nome, andar, status, id_climatizador, setpoint) VALUES (?, ?, ?, ?, ?)"
  );
  const insVav = db.prepare(
    "INSERT INTO VAV (status, abertura, vazao_ar, id_sala, modo, motivo) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insSensor = db.prepare(
    "INSERT INTO SENSOR (tipo, unidade, status, id_sala) VALUES (?, ?, ?, ?)"
  );
  const insLimite = db.prepare(
    "INSERT INTO LIMITE_ALERTA (tipo, valor_min, valor_max, id_sala) VALUES (?, ?, ?, ?)"
  );

  const tx = db.transaction(() => {
    const idSala = Number(
      insSala.run(nome.trim(), andar, "normal", idClimatizador, setpoint).lastInsertRowid
    );

    insVav.run("ok", vav.abertura ?? 40, vav.vazaoAr ?? 0, idSala, "auto", "estavel");

    for (const s of listaSensores) {
      insSensor.run(s.tipo, s.unidade ?? null, "ativo", idSala);
      if (s.limite) {
        insLimite.run(s.tipo, s.limite.min ?? null, s.limite.max ?? null, idSala);
      }
    }

    return idSala;
  });

  const idSala = tx();
  return { ok: true, id_sala: idSala };
}
