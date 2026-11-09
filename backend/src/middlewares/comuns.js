// ---------------------------------------------------------------------------
// Middlewares genericos de HTTP usados por todas as rotas.
// ---------------------------------------------------------------------------

import { ZodError } from "zod";

// Envolve handlers async (o Express 4 nao captura rejeicao de Promise).
export const assincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// INJECAO: todo :id / :salaId precisa ser inteiro positivo (senao 400).
// router.param vale so para o router onde e registrado, por isso cada
// arquivo de rotas chama validarIds(router).
function validarId(_req, res, next, valor) {
  return /^[1-9][0-9]{0,9}$/.test(valor) ? next() : res.status(400).json({ erro: "id invalido" });
}
export function validarIds(router) {
  router.param("id", validarId);
  router.param("salaId", validarId);
  return router;
}

export function rotaNaoEncontrada(_req, res) {
  res.status(404).json({ erro: "rota nao encontrada" });
}

// Tratamento de erros: mensagem curta para o cliente, detalhe so no log.
// Nunca devolve stack trace, SQL ou caminho de arquivo.
// eslint-disable-next-line no-unused-vars
export function tratarErros(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      erro: "entrada invalida",
      detalhes: err.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })),
    });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ erro: "JSON invalido" });
  if (err.type === "entity.too.large") return res.status(413).json({ erro: "corpo da requisicao grande demais" });
  if (String(err.code || "").startsWith("SQLITE_CONSTRAINT")) {
    return res.status(409).json({ erro: "violacao de integridade" });
  }
  console.error(err);
  res.status(500).json({ erro: "erro interno" });
}
