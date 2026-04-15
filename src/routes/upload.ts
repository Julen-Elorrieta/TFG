import { corsHeaders } from "../config/constants";
import { getMimeType } from "../utils/mime";
import { extractPdfText } from "../utils/pdf";

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

  if (mimeType === "application/pdf") {
    const text = await extractPdfText(buffer);
    return new Response(
      JSON.stringify({
        type: "text",
        filename,
        content: text,
        mimeType,
        size: buffer.byteLength,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    const text = new TextDecoder().decode(buffer);
    return new Response(
      JSON.stringify({
        type: "text",
        filename,
        content: text,
        mimeType,
        size: buffer.byteLength,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  if (mimeType.startsWith("image/")) {
    const base64 = Buffer.from(buffer).toString("base64");
    return new Response(
      JSON.stringify({
        type: "image",
        filename,
        content: base64,
        mimeType,
        size: buffer.byteLength,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const base64 = Buffer.from(buffer).toString("base64");
  return new Response(
    JSON.stringify({
      type: "binary",
      filename,
      content: base64,
      mimeType,
      size: buffer.byteLength,
    }),
    { headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}
