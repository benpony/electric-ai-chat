import * as crypto from 'crypto';
import * as fs from 'fs';

export function getFileChecksum(path: string, length?: number): string {
  const fileBuffer = fs.readFileSync(path);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex').slice(0, length);
}
