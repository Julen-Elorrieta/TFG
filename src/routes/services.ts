import { getServicesFromRequest } from "../services/registry";
import { jsonResponse } from "../utils/http";

export async function handleServicesRoute(req: Request): Promise<Response> {
  const { registry } = await getServicesFromRequest(req);
  const services = Object.keys(registry);
  if (services.length > 0) services.unshift("auto");
  return jsonResponse({ services });
}
