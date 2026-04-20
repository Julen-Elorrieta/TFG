function buildMarkdownExportArtifact(conversation) {
  let content = `# ${conversation.title}\n\n_Exportado: ${new Date().toLocaleString()}_\n\n---\n\n`;
  if (conversation.systemPrompt) {
    content += `**System Prompt:** ${conversation.systemPrompt}\n\n---\n\n`;
  }
  conversation.messages.forEach((m) => {
    const service = m.service
      ? ` (${m.service}${m.model ? ` · ${m.model}` : ""})`
      : "";
    content += `## ${m.role === "user" ? "👤 Tú" : `🤖 Asistente${service}`}\n\n${m.content}\n\n---\n\n`;
  });
  return { content, ext: "md", mime: "text/markdown" };
}

function buildJsonExportArtifact(conversation) {
  const content = JSON.stringify(
    {
      title: conversation.title,
      exportedAt: new Date().toISOString(),
      systemPrompt: conversation.systemPrompt,
      messages: conversation.messages.map((m) => ({
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

function buildPlainTextExportArtifact(conversation) {
  let content = `${conversation.title}\nExportado: ${new Date().toLocaleString()}\n${"=".repeat(50)}\n\n`;
  conversation.messages.forEach((m) => {
    content += `[${m.role === "user" ? "TÚ" : `ASISTENTE${m.service ? ` - ${m.service}` : ""}`}]\n${m.content}\n\n${"-".repeat(40)}\n\n`;
  });
  return { content, ext: "txt", mime: "text/plain" };
}

export function buildConversationExportArtifact(conversation, format) {
  if (format === "markdown") return buildMarkdownExportArtifact(conversation);
  if (format === "json") return buildJsonExportArtifact(conversation);
  return buildPlainTextExportArtifact(conversation);
}
