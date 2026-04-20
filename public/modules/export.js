function buildMarkdownExport(conv) {
  let content = `# ${conv.title}\n\n_Exportado: ${new Date().toLocaleString()}_\n\n---\n\n`;
  if (conv.systemPrompt) {
    content += `**System Prompt:** ${conv.systemPrompt}\n\n---\n\n`;
  }
  conv.messages.forEach((m) => {
    const service = m.service ? ` (${m.service}${m.model ? ` · ${m.model}` : ""})` : "";
    content += `## ${m.role === "user" ? "👤 Tú" : `🤖 Asistente${service}`}\n\n${m.content}\n\n---\n\n`;
  });
  return { content, ext: "md", mime: "text/markdown" };
}

function buildJsonExport(conv) {
  const content = JSON.stringify(
    {
      title: conv.title,
      exportedAt: new Date().toISOString(),
      systemPrompt: conv.systemPrompt,
      messages: conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
        service: m.service,
        model: m.model,
        timestamp: m.timestamp,
      })),
    },
    null,
    2,
  );
  return { content, ext: "json", mime: "application/json" };
}

function buildTextExport(conv) {
  let content = `${conv.title}\nExportado: ${new Date().toLocaleString()}\n${"=".repeat(50)}\n\n`;
  conv.messages.forEach((m) => {
    content += `[${m.role === "user" ? "TÚ" : `ASISTENTE${m.service ? ` - ${m.service}` : ""}`}]\n${m.content}\n\n${"-".repeat(40)}\n\n`;
  });
  return { content, ext: "txt", mime: "text/plain" };
}

export function buildExportArtifact(conv, format) {
  if (format === "markdown") return buildMarkdownExport(conv);
  if (format === "json") return buildJsonExport(conv);
  return buildTextExport(conv);
}
