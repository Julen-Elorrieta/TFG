export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder("latin1" as any).decode(bytes);
    const texts: string[] = [];
    const btEtRegex = /BT([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(str)) !== null) {
      const block = match[1] ?? "";
      if (!block) continue;
      const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)|<([0-9a-fA-F]+)>/g;
      let tj;
      while ((tj = tjRegex.exec(block)) !== null) {
        if (tj[1] !== undefined) {
          const decoded = tj[1]
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\(/g, "(")
            .replace(/\\\)/g, ")")
            .replace(/\\\\/g, "\\");
          texts.push(decoded);
        } else if (tj[2] !== undefined) {
          const hex = tj[2];
          let hexStr = "";
          for (let i = 0; i < hex.length; i += 2) {
            hexStr += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          }
          texts.push(hexStr);
        }
      }
    }
    const result = texts.join(" ").replace(/\s+/g, " ").trim();
    return result.length > 50
      ? result
      : "[PDF text extraction yielded minimal content — the PDF may use embedded fonts or images for text]";
  } catch {
    return "[Could not extract PDF text]";
  }
}
