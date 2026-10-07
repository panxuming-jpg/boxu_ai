import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const MAX_PROMPT = 4000;
export const MAX_IMAGES = 20;
export const MAX_FILE_SIZE = 15 * 1024 * 1024;
