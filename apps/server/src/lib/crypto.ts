/**
 * 认证相关的小工具：
 * - 南京大学统一身份认证（金智 CAS）的密码加密；
 * - 本地保存 ehall 会话 Cookie 时的对称加密。
 *
 * 注意：CAS 的加密方式属于"跟着对方前端 JS 走"的隐式协议，学校升级后可能变化。
 * 因此这里把细节集中在一个文件，并在失败时给出可操作的错误码，而不是静默失败。
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* 金智 CAS 密码加密                                                   */
/* ------------------------------------------------------------------ */

const IV_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += IV_CHARS[bytes[i]! % IV_CHARS.length];
  return out;
}

/**
 * 金智 CAS 默认实现：
 *   key = pwdEncryptSalt（16 字符），iv = 随机 16 字符
 *   ciphertext = base64(AES-128-CBC(password))
 *   提交值 = iv + ciphertext
 */
export function encryptCasPassword(password: string, salt: string): string {
  const iv = randomString(16);
  const key = Buffer.from(salt, 'utf8');
  const cipher = createCipheriv(key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc', key, Buffer.from(iv, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('base64');
  return `${iv}${encrypted}`;
}

/* ------------------------------------------------------------------ */
/* 本地会话加密                                                        */
/* ------------------------------------------------------------------ */

export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export interface SealedBox {
  iv: string;
  tag: string;
  data: string;
}

export function seal(plain: string, secret: string): SealedBox {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function unseal(box: SealedBox, secret: string): string {
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

export function randomId(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** 日志脱敏：学号只保留前 4 位与后 2 位。 */
export function maskStudentId(id: string): string {
  if (id.length <= 6) return '***';
  return `${id.slice(0, 4)}****${id.slice(-2)}`;
}
