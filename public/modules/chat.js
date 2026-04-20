export function buildMessageApiContent(message) {
  const files = message.files ?? [];
  if (files.length === 0) return message.content;
  let extra = "";
  files.forEach((f) => {
    if (f.displayType === "image") extra += `[Imagen adjunta: ${f.name}]\n`;
    else if (f.fileContent)
      extra += `\n--- Archivo: ${f.name} ---\n${f.fileContent}\n---\n`;
    else if (f.displayType === "binary")
      extra += `[Archivo binario adjunto: ${f.name} (${f.mimeType})]\n`;
  });
  return (message.content ? `${message.content}\n\n` : "") + extra.trim();
}
