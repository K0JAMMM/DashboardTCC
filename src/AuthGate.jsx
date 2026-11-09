import { useEffect, useState } from "react";
import { api, getToken } from "./api/client.js";
import LoginPage from "./pages/LoginPage.jsx";

// No modo backend real, so renderiza o dashboard com sessao valida.
// Qualquer 401 da API dispara "auth:expired" e volta para o login.
export default function AuthGate({ children }) {
  const [logado, setLogado] = useState(api.mode === "mock" || !!getToken());

  useEffect(() => {
    const sair = () => setLogado(api.mode === "mock");
    window.addEventListener("auth:expired", sair);
    return () => window.removeEventListener("auth:expired", sair);
  }, []);

  if (!logado) return <LoginPage onLogin={() => setLogado(true)} />;
  return children;
}
