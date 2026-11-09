// Escapa uma celula de CSV contra injecao de formula (CSV/Formula Injection).
// Excel/LibreOffice executam celulas que comecam com = + - @ (ou TAB/CR) como
// formula - ex.: =HYPERLINK("http://site-malicioso", "clique"). Prefixar com
// apostrofo faz a celula ser lida como TEXTO. Depois, aspas sao duplicadas.
const PERIGOSO = /^[=+\-@\t\r]/;

export function escCsv(valor) {
  let t = String(valor ?? "");
  if (PERIGOSO.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}
