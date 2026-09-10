import fs from 'fs';
import path from 'path';

export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export function contractFilePath(contractNumber: string, filename: string): string {
  const dir = path.join(UPLOADS_DIR, contractNumber);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}
