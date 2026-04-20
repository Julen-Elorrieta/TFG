import { existsSync } from "node:fs";
import { join } from "node:path";

function configureTrustedCa(): void {
  if (process.env.NODE_EXTRA_CA_CERTS) return;
  const localCa = join(process.cwd(), "zscaler.crt");
  if (existsSync(localCa)) {
    process.env.NODE_EXTRA_CA_CERTS = localCa;
  }
}

configureTrustedCa();

await import("./src/server");
