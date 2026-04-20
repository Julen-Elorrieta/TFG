import { corsHeaders } from "../config/constants";

function normalizeHeadersToRecord(
  headers: ResponseInit["headers"],
): Record<string, string> {
  const record: Record<string, string> = {};
  if (!headers) return record;

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const key = entry[0];
      if (key === undefined) continue;
      const value = entry[1];
      record[key] = String(value ?? "");
    }
    return record;
  }

  const headersWithForEach = headers as {
    forEach?: (callback: (value: string, key: string) => void) => void;
  };
  if (typeof headersWithForEach.forEach === "function") {
    headersWithForEach.forEach((value, key) => {
      record[key] = String(value);
    });
    return record;
  }

  for (const [key, value] of Object.entries(
    headers as Record<string, string>,
  )) {
    record[key] = String(value);
  }
  return record;
}

export function jsonResponse(
  payload: unknown,
  init: ResponseInit = {},
): Response {
  const { headers: initHeaders, ...rest } = init;
  const headers: Record<string, string> = {
    ...normalizeHeadersToRecord(initHeaders),
    ...corsHeaders,
    "Content-Type": "application/json",
  };
  return new Response(JSON.stringify(payload), { ...rest, headers });
}

export function jsonErrorResponse(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return jsonResponse({ error, ...(extra ?? {}) }, { status });
}
