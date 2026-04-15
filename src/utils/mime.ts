const MIME_TYPE_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  js: "text/javascript",
  ts: "text/typescript",
  html: "text/html",
  css: "text/css",
  py: "text/x-python",
  rs: "text/x-rust",
  go: "text/x-go",
  java: "text/x-java",
  cpp: "text/x-c++",
  c: "text/x-c",
  rb: "text/x-ruby",
  php: "text/x-php",
  sh: "text/x-sh",
  yaml: "text/x-yaml",
  yml: "text/x-yaml",
  toml: "text/x-toml",
  xml: "text/xml",
  sql: "text/x-sql",
  dockerfile: "text/plain",
};

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPE_MAP[ext] ?? "application/octet-stream";
}
