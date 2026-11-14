import fs from "node:fs";
import path from "node:path";

/**
 * Loads `.env.local` and `.env` from the repository root without overwriting
 * variables already provided by the shell, PM2, or container runtime.
 */
export function loadLocalEnvFiles(cwd = process.cwd()): void {
  const files = [".env.local", ".env"];
  for (const filename of files) {
    const fullPath = path.join(cwd, filename);
    if (!fs.existsSync(fullPath)) continue;

    let raw = "";
    try {
      raw = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || process.env[key] !== undefined) continue;

      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
