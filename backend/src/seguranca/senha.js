// ---------------------------------------------------------------------------
// Criptografia de senhas e tokens.
//
// - Senhas: scrypt (KDF lenta e com custo de memoria, nativa do Node) com
//   salt aleatorio de 16 bytes por senha. Nunca guardamos a senha, so o hash.
//   Formato armazenado: scrypt$N$r$p$<salt hex>$<hash hex>
// - Comparacao em tempo constante (crypto.timingSafeEqual) para nao vazar
//   informacao por diferenca de tempo.
// - Tokens de dispositivo (ESP32): 256 bits aleatorios; no banco fica so o
//   SHA-256 do token.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

const N = 16384; // custo de CPU/memoria (2^14)
const R = 8;
const P = 1;
const TAM_HASH = 64;

function scrypt(senha, salt, n = N, r = R, p = P) {
  return new Promise((ok, erro) =>
    crypto.scrypt(senha, salt, TAM_HASH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) =>
      e ? erro(e) : ok(k)
    )
  );
}

export async function hashSenha(senha) {
  if (typeof senha !== "string" || !senha) throw new Error("senha invalida");
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(senha.normalize("NFKC"), salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verificarSenha(senha, armazenado) {
  if (typeof senha !== "string" || typeof armazenado !== "string") return false;
  const partes = armazenado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = partes;
  const esperado = Buffer.from(hashHex, "hex");
  const calculado = await scrypt(senha.normalize("NFKC"), Buffer.from(saltHex, "hex"), +n, +r, +p);
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

// ----- Politica de senha forte -------------------------------------------
const SENHAS_COMUNS = new Set([
  "123456789012", "senha1234567", "password1234", "qwertyuiop12", "admin1234567",
  "Senha@123456", "Password@123", "Admin@123456", "Mudar@123456", "Hvac@1234567",
]);

export function validarPoliticaSenha(senha, login = "") {
  const erros = [];
  if (typeof senha !== "string") return ["senha precisa ser texto"];
  if (senha.length < 12) erros.push("minimo de 12 caracteres");
  if (senha.length > 128) erros.push("maximo de 128 caracteres");
  if (!/[a-z]/.test(senha)) erros.push("precisa de letra minuscula");
  if (!/[A-Z]/.test(senha)) erros.push("precisa de letra maiuscula");
  if (!/[0-9]/.test(senha)) erros.push("precisa de numero");
  if (!/[^A-Za-z0-9]/.test(senha)) erros.push("precisa de simbolo");
  if (SENHAS_COMUNS.has(senha)) erros.push("senha muito comum");
  if (login && senha.toLowerCase().includes(String(login).toLowerCase())) erros.push("senha nao pode conter o login");
  return erros;
}

// ----- Tokens de dispositivo ---------------------------------------------
export function gerarTokenDispositivo() {
  return crypto.randomBytes(32).toString("hex"); // 256 bits
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
