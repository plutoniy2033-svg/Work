import { assertCorpNetwork } from './helpers/network-guard';

export default async function globalSetup(): Promise<void> {
  await assertCorpNetwork();
}
