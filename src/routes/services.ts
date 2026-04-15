import { corsHeaders } from "../config/constants";
import { getServicesFromRequest } from "../services/registry";

export async function handleServicesRoute(req: Request): Promise<Response> {
  const { registry } = await getServicesFromRequest(req);
  const services = Object.keys(registry);
  if (services.length > 0) services.unshift("auto");
  return new Response(JSON.stringify({ services }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
