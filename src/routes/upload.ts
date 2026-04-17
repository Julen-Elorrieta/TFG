import { corsHeaders } from "../config/constants";
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
  return new Response(
    JSON.stringify({
      type,
      filename,
      content,
      mimeType,
      size,
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

export async function handleUploadRoute(req: Request): Promise<Response> {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
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

  if (mimeType.startsWith("image/")) {
    const base64 = Buffer.from(buffer).toString("base64");
    return createUploadResponse("image", filename, base64, mimeType, size);
  }

  const base64 = Buffer.from(buffer).toString("base64");
  return createUploadResponse("binary", filename, base64, mimeType, size);
}
