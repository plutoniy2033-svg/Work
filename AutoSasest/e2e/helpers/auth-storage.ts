import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Файл сессии после успешного входа (шаг 02). */
export const CORP_AUTH_STORAGE = path.join(__dirname, '..', '.auth', 'corp.json');
