const MAX_FILE_CHARS = 8000;

export function truncateFileContent(text) {
  if (!text) return "";
  if (text.length <= MAX_FILE_CHARS) return text;
  const half = Math.floor(MAX_FILE_CHARS / 2);
  return (
    text.slice(0, half) +
    `\n\n[... contenido truncado — ${text.length.toLocaleString()} caracteres totales ...]\n\n` +
    text.slice(-half)
  );
}

export function getFileIcon(mimeType) {
  if (!mimeType) return "📎";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.includes("json")) return "🔧";
  if (mimeType.includes("csv")) return "📊";
  if (
    mimeType.includes("python") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript")
  ) {
    return "💻";
  }
  if (mimeType.startsWith("text/")) return "📝";
  return "📎";
}

export function getFileLabel(mimeType, filename) {
  if (!mimeType) return "Archivo";
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase();
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("json")) return "JSON";
  if (mimeType.includes("csv")) return "CSV";
  const ext = filename?.split(".").pop()?.toUpperCase();
  if (ext) return ext;
  if (mimeType.startsWith("text/")) return "TEXTO";
  return "ARCHIVO";
}

export function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
