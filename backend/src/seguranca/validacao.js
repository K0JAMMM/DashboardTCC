// ---------------------------------------------------------------------------
// Validacao de entrada (anti-injecao).
//
// Todo corpo de requisicao passa por um schema zod ESTRITO:
//  - tipos exatos (numero e numero, nao string "999" nem objeto {"$gt":0});
//  - .strict(): chave desconhecida => 400 (bloqueia mass assignment e
//    tentativas como "__proto__", "papel", "id_sala" ou nomes de coluna SQL);
//  - textos com allowlist de caracteres (bloqueia <script>, aspas, ; etc.).
// Isso se soma as queries parametrizadas (?) do better-sqlite3.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const LIMITES = {
  abertura: [0, 100],
  setpoint: [16, 30],
  insuflamento: [12, 20],
};

// Faixa fisica possivel por tipo de sensor (leitura fora disso e lixo/ataque).
export const FAIXA_FISICA = { temperatura: [-40, 85], umidade: [0, 100], co2: [0, 10000] };

// Letras (com acento), numeros, espaco e pontuacao inofensiva. Sem < > " ' ; ` = { } \
const TEXTO_SEGURO = /^[\p{L}\p{N} .,_\-()/ºª°]+$/u;
export const textoSeguro = (max = 80) =>
  z.string().trim().min(1).max(max).regex(TEXTO_SEGURO, "contem caracteres nao permitidos");

const numero = (min, max) => z.number().finite().min(min).max(max);
const idPositivo = z.number().int().positive();

export const loginSchema = z
  .object({
    login: z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, "login invalido"),
    senha: z.string().min(1).max(128),
    website: z.string().max(200).optional(), // honeypot anti-bot (campo invisivel no formulario)
  })
  .strict();

export const novoUsuarioSchema = z
  .object({
    login: z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, "login invalido"),
    senha: z.string().max(128),
    papel: z.enum(["viewer", "operator", "admin"]),
    salas: z.array(idPositivo).max(100).optional(),
  })
  .strict();

export const trocarSenhaSchema = z
  .object({ senhaAtual: z.string().max(128).optional(), novaSenha: z.string().max(128) })
  .strict();

export const telemetriaSchema = z
  .object({
    id_sensor: idPositivo,
    valor: z.number().finite(),
    qualidade: z.enum(["boa", "regular", "ruim"]).optional(),
  })
  .strict();

export const vavAberturaSchema = z.object({ abertura: numero(...LIMITES.abertura) }).strict();
export const vavModoSchema = z.object({ modo: z.enum(["auto", "manual"]) }).strict();
export const vavFalhaSchema = z.object({ falha: z.boolean() }).strict();
export const setpointSchema = z.object({ setpoint: numero(...LIMITES.setpoint) }).strict();
export const climatizadorPatchSchema = z
  .object({ ligado: z.boolean().optional(), tempInsuflamento: numero(...LIMITES.insuflamento).optional() })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "corpo vazio");

export const salaCompletaSchema = z
  .object({
    nome: textoSeguro(80),
    andar: textoSeguro(10).optional(),
    idClimatizador: idPositivo,
    setpoint: numero(...LIMITES.setpoint).optional(),
    vav: z.object({ abertura: numero(0, 100).optional(), vazaoAr: numero(0, 1e6).optional() }).strict().optional(),
    sensores: z
      .array(
        z
          .object({
            tipo: z.enum(["temperatura", "umidade", "co2"]),
            unidade: textoSeguro(10).optional(),
            limite: z.object({ min: numero(-1e4, 1e4), max: numero(-1e4, 1e4) }).strict().optional(),
          })
          .strict()
      )
      .max(10)
      .optional(),
  })
  .strict();

export const dispositivoSchema = z.object({ nome: textoSeguro(60), idSala: idPositivo }).strict();

// ----- Escrita do CRUD generico: allowlist por tabela ----------------------
// Nunca inclui chaves estrangeiras (id_sala, id_climatizador...) => nao da para
// "mover" sensor/VAV para outra sala trocando o ID no corpo.
export const crudSchemas = {
  CLIMATIZADOR: {
    criar: z.object({ nome: textoSeguro(80), capacidade: numero(0, 1e7) }).strict(),
    atualizar: z.object({ nome: textoSeguro(80), capacidade: numero(0, 1e7) }).partial().strict(),
  },
  SALA: {
    atualizar: z
      .object({ nome: textoSeguro(80), andar: textoSeguro(10), setpoint: numero(...LIMITES.setpoint) })
      .partial()
      .strict(),
  },
  LIMITE_ALERTA: {
    atualizar: z.object({ valor_min: numero(-1e4, 1e4), valor_max: numero(-1e4, 1e4) }).partial().strict(),
  },
};
