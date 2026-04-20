export function buildApiContent(msg) {
  const files = msg.files ?? [];
  if (files.length === 0) return msg.content;
  let extra = "";
  files.forEach((f) => {
    if (f.displayType === "image") extra += `[Imagen adjunta: ${f.name}]\n`;
    else if (f.fileContent)
      extra += `\n--- Archivo: ${f.name} ---\n${f.fileContent}\n---\n`;
    else if (f.displayType === "binary")
      extra += `[Archivo binario adjunto: ${f.name} (${f.mimeType})]\n`;
  });
  return (msg.content ? `${msg.content}\n\n` : "") + extra.trim();
}
