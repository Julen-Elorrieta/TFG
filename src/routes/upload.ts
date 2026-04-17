import { jsonErrorResponse, jsonResponse } from "../utils/http";
import { getMimeType } from "../utils/mime";
import { extractPdfText } from "../utils/pdf";

type UploadContentType = "text" | "image" | "binary";

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

export async function handleUploadRoute(req: Request): Promise<Response> {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return jsonErrorResponse("No file provided", 400);
  }

  const filename = file.name;
  const mimeType = getMimeType(filename);
  const buffer = await file.arrayBuffer();
  const size = buffer.byteLength;

  if (mimeType === "application/pdf") {
    const text = await extractPdfText(buffer);
    return createUploadResponse("text", filename, text, mimeType, size);
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    const text = new TextDecoder().decode(buffer);
    return createUploadResponse("text", filename, text, mimeType, size);
  }

  const base64 = Buffer.from(buffer).toString("base64");
  const contentType: UploadContentType = mimeType.startsWith("image/")
    ? "image"
    : "binary";
  return createUploadResponse(contentType, filename, base64, mimeType, size);
}
