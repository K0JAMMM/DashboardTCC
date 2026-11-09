import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ConfigProvider } from "./context/ConfigContext.jsx";
import AuthGate from "./AuthGate.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthGate>
        <ConfigProvider>
          <App />
        </ConfigProvider>
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>
);
