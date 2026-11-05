import { isRecord, isUuid } from './events.js';

// Byte budgets protect requests/runtime, independently of roster or team counts.
export const maximumPrivateWriteBytes = 4 * 1024 * 1024;
export const maximumPrivateValueBytes = 32 * 1024 * 1024;
export const privateWritePartBytes = 6 * 1024;
export const privateReadPartCharacters = 24 * 1024;
export const maximumPrivateWriteParts = Math.ceil(maximumPrivateWriteBytes / privateWritePartBytes);

export interface PrivateUpload {
  readonly id: string;
  readonly bytes: number;
  readonly parts: number;
  readonly sha256: string;
}

export interface PrivateUploadPart extends PrivateUpload {
  readonly index: number;
  readonly content: string;
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isPrivateUpload(value: unknown): value is PrivateUpload {
  return isRecord(value) && isUuid(value.id) && isSha256(value.sha256)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0
    && value.bytes <= maximumPrivateWriteBytes
    && typeof value.parts === 'number' && value.parts === Math.ceil(value.bytes / privateWritePartBytes);
}

export function isPrivateUploadPart(value: unknown): value is PrivateUploadPart {
  return isPrivateUpload(value) && isRecord(value)
    && typeof value.index === 'number' && Number.isSafeInteger(value.index) && value.index >= 0 && value.index < value.parts
    && typeof value.content === 'string' && value.content.length <= 4 * Math.ceil(privateWritePartBytes / 3)
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.content);
}

export interface PrivateReadPart {
  readonly privateRead: {
    readonly sha256: string;
    readonly index: number;
    readonly parts: number;
    readonly bytes: number;
    readonly content: string;
  };
}

export function isPrivateReadPart(value: unknown): value is PrivateReadPart {
  if (!isRecord(value) || !isRecord(value.privateRead)) return false;
  const part = value.privateRead;
  return isSha256(part.sha256) && typeof part.bytes === 'number' && Number.isSafeInteger(part.bytes)
    && part.bytes > 0 && part.bytes <= maximumPrivateValueBytes
    && typeof part.parts === 'number' && Number.isSafeInteger(part.parts) && part.parts > 0
    && part.parts <= Math.ceil(maximumPrivateValueBytes / privateReadPartCharacters)
    && typeof part.index === 'number' && Number.isSafeInteger(part.index) && part.index >= 0 && part.index < part.parts
    && typeof part.content === 'string' && part.content.length <= privateReadPartCharacters;
}
