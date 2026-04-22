import { probeCorpAccess } from './corp-probe.mjs';

export async function checkCorpNetwork() {
  return probeCorpAccess(process.env);
}
