import { statusLabel } from "../theme.js";

// Badge de status. Nunca depende SO da cor (acessibilidade): traz sempre rotulo.
export default function StatusBadge({ status }) {
  return <span className={`badge badge--${status}`}>{statusLabel[status]}</span>;
}
