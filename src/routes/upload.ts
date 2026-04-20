import { jsonErrorResponse, jsonResponse } from "../utils/http";
import { getMimeType } from "../utils/mime";
import { extractPdfText } from "../utils/pdf";

type UploadContentType = "text" | "image";

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function getMaxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (!raw) return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return parsed;
}

function createUploadResponse(
  type: UploadContentType,
  filename: string,
  content: string,
  mimeType: string,
  size: number,
): Response {
  return jsonResponse({
    type,
    filename,
    content,
    mimeType,
    size,
  });
}

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json";
}

function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

function detectMimeTypeBySignature(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function resolveMimeType(file: File, bytes: Uint8Array): string {
  const signatureMime = detectMimeTypeBySignature(bytes);
  if (signatureMime) return signatureMime;

  const extensionMime = getMimeType(file.name);
  if (isTextMimeType(extensionMime)) return extensionMime;

  const browserMime = file.type || "";
  if (isTextMimeType(browserMime)) return browserMime;
  return "application/octet-stream";
}

export async function handleUploadRoute(req: Request): Promise<Response> {
  let rawFile: unknown = null;
  try {
    rawFile = (await req.formData()).get("file");
  } catch (error: unknown) {
    console.error("[ERROR] /upload formData:", error);
    return jsonErrorResponse("Invalid multipart form-data payload", 400);
  }

  if (!(rawFile instanceof File)) {
    return jsonErrorResponse("No file provided", 400);
  }

  const buffer = await rawFile.arrayBuffer();
  const size = buffer.byteLength;
  if (size === 0) {
    return jsonErrorResponse("Empty file", 400);
  }

  const maxUploadBytes = getMaxUploadBytes();
  if (size > maxUploadBytes) {
    return jsonErrorResponse(
      `File too large. Maximum size is ${(maxUploadBytes / (1024 * 1024)).toFixed(1)} MB`,
      413,
      { maxBytes: maxUploadBytes },
    );
  }

  const bytes = new Uint8Array(buffer);
  const mimeType = resolveMimeType(rawFile, bytes);
  const filename = rawFile.name;

  if (mimeType === "application/pdf") {
    const text = await extractPdfText(buffer);
    return createUploadResponse("text", filename, text, mimeType, size);
  }

  if (isTextMimeType(mimeType)) {
    const text = new TextDecoder().decode(buffer);
    return createUploadResponse("text", filename, text, mimeType, size);
  }

  if (isImageMimeType(mimeType)) {
    const base64 = Buffer.from(buffer).toString("base64");
    return createUploadResponse("image", filename, base64, mimeType, size);
  }

  return jsonErrorResponse(
    `Unsupported file type: ${mimeType || "unknown"}. Allowed types: text, JSON, PDF, PNG, JPEG, GIF, WEBP.`,
    415,
  );
}
