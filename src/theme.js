// Referencias: WCAG 2.2 (contraste), EPA AQI (escala de qualidade do ar), Material Design 3.
export const palette = {
  primary: "#0F4C81", // Azul escuro tecnico - cabecalho, navegacao, botoes principais
  secondary: "#4FA3D9", // Azul-claro/ciano - cartoes, links, series de grafico
  success: "#2E8B57", // Verde - estado normal, dentro da faixa
  warning: "#F4B400", // Ambar - atencao, pre-alarme, limite proximo
  critical: "#D64545", // Vermelho - alarme ativo, falha, fora do limite
  background: "#F5F7FA", // Cinza muito claro - fundo
  surface: "#FFFFFF", // Branco - cartoes de telemetria
  text: "#1F2937", // Cinza escuro - texto principal
};

// Escala de qualidade do ar (CO2) inspirada no AQI da EPA.
export const aqiScale = [
  { level: "Bom", color: palette.success, max: 800 },
  { level: "Moderado", color: palette.warning, max: 1200 },
  { level: "Ruim", color: palette.critical, max: Infinity },
];

export const STATUS = {
  NORMAL: "normal",
  ATENCAO: "atencao",
  CRITICO: "critico",
};

export const statusColor = {
  [STATUS.NORMAL]: palette.success,
  [STATUS.ATENCAO]: palette.warning,
  [STATUS.CRITICO]: palette.critical,
};

export const statusLabel = {
  [STATUS.NORMAL]: "Normal",
  [STATUS.ATENCAO]: "Atencao",
  [STATUS.CRITICO]: "Critico",
};
