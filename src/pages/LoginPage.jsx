import { useState } from "react";
import { login } from "../api/client.js";

// Tela de login (modo backend real).
// O campo "website" e um HONEYPOT anti-bot: fica fora da tela e fora da
// navegacao por teclado. Pessoas nao o preenchem; bots que preenchem todo
// input do formulario sao recusados pelo backend.
export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ login: "", senha: "", website: "" });
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  async function entrar(e) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const usuario = await login(form.login.trim(), form.senha, form.website);
      onLogin(usuario);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <form className="card" onSubmit={entrar} style={{ width: "100%", maxWidth: 360 }}>
        <h3 className="card__title">❄️ HVAC Supervisao — Entrar</h3>

        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="login">Login</label>
          <input id="login" autoComplete="username" value={form.login} onChange={set("login")} required maxLength={32} />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="senha">Senha</label>
          <input id="senha" type="password" autoComplete="current-password" value={form.senha} onChange={set("senha")} required maxLength={128} />
        </div>

        {/* honeypot anti-bot: invisivel para pessoas */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </div>

        {erro && (
          <p role="alert" style={{ color: "var(--color-critical)", margin: "0 0 12px" }}>
            {erro}
          </p>
        )}
        <button className="btn btn--primary" type="submit" disabled={enviando} style={{ width: "100%" }}>
          {enviando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
