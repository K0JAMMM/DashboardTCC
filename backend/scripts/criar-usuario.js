// Cria um usuario pela linha de comando, sem senha no codigo nem no historico do shell.
// Uso (PowerShell):
//   $env:NOVA_SENHA="<sua senha forte>"; node scripts/criar-usuario.js operador1 operator 1,2
// Uso (bash):
//   NOVA_SENHA='<sua senha forte>' node scripts/criar-usuario.js operador1 operator 1,2
import { criarUsuario } from "../src/servicos/usuarios.js";

const [login, papel, salasCsv = ""] = process.argv.slice(2);
const senha = process.env.NOVA_SENHA;

if (!login || !["viewer", "operator", "admin"].includes(papel) || !senha) {
  console.error("uso: NOVA_SENHA='<senha forte>' node scripts/criar-usuario.js <login> <viewer|operator|admin> [salas ex.: 1,2]");
  process.exit(1);
}

const salas = salasCsv.split(",").filter(Boolean).map(Number);
const r = await criarUsuario({ login, senha, papel, salas });
if (!r.ok) {
  console.error(`erro: ${r.erro} ${(r.detalhes || []).join(", ")}`);
  process.exit(1);
}
console.log(`usuario ${login} (${papel}) criado; salas: ${salas.join(", ") || "nenhuma"}`);
