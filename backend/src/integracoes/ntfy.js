// ---------------------------------------------------------------------------
// Integracao com o ntfy.sh (RF17): envia notificacao de alerta.
// Fica DESLIGADA ate o server.js chamar configurarNtfy() com a config do .env
// (nao existe topico publico padrao no codigo).
// ---------------------------------------------------------------------------

let ntfy = { ativo: false };

export function configurarNtfy(cfg) {
  ntfy = cfg || { ativo: false };
}

// Publica o alerta no ntfy.sh (RF17).
export async function enviarNtfy(nivel, mensagem) {
  if (!ntfy.ativo) return;
  try {
    await fetch(`${ntfy.server}/${encodeURIComponent(ntfy.topic)}`, {
      method: "POST",
      headers: {
        ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}),
        Title: nivel === "critico" ? "HVAC - ALARME CRITICO" : "HVAC - Atencao",
        Priority: nivel === "critico" ? "urgent" : "high",
        Tags: nivel === "critico" ? "rotating_light" : "warning",
      },
      body: mensagem,
    });
  } catch (e) {
    console.error("Falha ao enviar ntfy:", e.message);
  }
}
