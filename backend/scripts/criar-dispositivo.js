// Cadastra um dispositivo (ESP32) e mostra o token UMA unica vez (no banco fica so o hash).
// Uso: node scripts/criar-dispositivo.js "ESP32 Sala 1" 1
import { criarDispositivo } from "../src/servicos/usuarios.js";

const [nome, idSala] = process.argv.slice(2);
if (!nome || !Number(idSala)) {
  console.error('uso: node scripts/criar-dispositivo.js "<nome>" <id_sala>');
  process.exit(1);
}
const r = criarDispositivo({ nome, idSala: Number(idSala) });
if (!r.ok) {
  console.error(`erro: ${r.erro}`);
  process.exit(1);
}
console.log(`Dispositivo #${r.dispositivo.id} (${nome}) -> sala ${idSala}`);
console.log(`X-Device-Token: ${r.token}`);
console.log("Guarde este token no firmware; ele nao sera exibido novamente.");
