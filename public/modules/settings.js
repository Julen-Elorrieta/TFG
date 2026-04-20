export function inferUnusableServiceReason(message = "") {
  const msg = String(message).toLowerCase();
  if (
    msg.includes("insufficient credits") ||
    msg.includes("402") ||
    msg.includes("quota")
  ) {
    return "Sin créditos";
  }
  if (
    msg.includes("model_not_found") ||
    msg.includes("does not exist") ||
    msg.includes("not_found")
  ) {
    return "Modelo no disponible";
  }
  if (
    msg.includes("unauthorized") ||
    msg.includes("invalid api key") ||
    msg.includes("401")
  ) {
    return "API key inválida";
  }
  return "";
}
