import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export interface AccountRecord {
  ownerId: string;
  username: string;
  usernameRef: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

export function usernameRef(username: string): string {
  const hex = createHash('sha256').update(`zh-account:${normalizeUsername(username)}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')): Promise<{
  salt: string;
  passwordHash: string;
}> {
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return { salt, passwordHash: derived.toString('hex') };
}

export async function passwordMatches(password: string, salt: string, expectedHex: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) return false;
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(expectedHex, 'hex'));
}
