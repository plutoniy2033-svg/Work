import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function assertCorpNetwork(): Promise<void> {
  const { probeCorpAccess } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'server', 'corp-probe.mjs'))
      .href,
  );
  const r = await probeCorpAccess();
  if (!r.ok) {
    throw new Error(
      r.reason
        ? `Корпоративная сеть / CRM: ${r.reason}`
        : 'Корпоративная сеть / CRM недоступны',
    );
  }
}
