import { base64ToUint8Array, dataUrlToBase64, uint8ArrayToBase64 } from "@/lib/media";
import type { CharacterCardV2 } from "@/lib/card-schema";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function embedCardInPngDataUrl(imageDataUrl: string, card: CharacterCardV2): string {
  const mimeMatch = imageDataUrl.match(/^data:([^;]+);base64,/);
  if (!mimeMatch || mimeMatch[1] !== "image/png") {
    throw new Error("PNG 角色卡需要 PNG 头像图片。请上传 PNG，或先导出 JSON。");
  }

  const bytes = base64ToUint8Array(dataUrlToBase64(imageDataUrl));
  const embedded = embedCardInPngBytes(bytes, card);
  return `data:image/png;base64,${uint8ArrayToBase64(embedded)}`;
}

export function embedCardInPngBytes(pngBytes: Uint8Array, card: CharacterCardV2): Uint8Array {
  assertPng(pngBytes);
  const chunks = readPngChunks(pngBytes);
  const charaValue = uint8ArrayToBase64(textEncoder.encode(JSON.stringify(card)));
  const textChunk = createTextChunk("chara", charaValue);
  const output: Uint8Array[] = [PNG_SIGNATURE];
  let inserted = false;

  for (const chunk of chunks) {
    if (!inserted && chunk.type === "IDAT") {
      output.push(textChunk);
      inserted = true;
    }

    if (chunk.type !== "tEXt" || !isCharaTextChunk(chunk.data)) {
      output.push(chunk.raw);
    }
  }

  if (!inserted) {
    output.splice(output.length - 1, 0, textChunk);
  }

  return concat(output);
}

export function extractCardFromPngBytes(pngBytes: Uint8Array): CharacterCardV2 | null {
  assertPng(pngBytes);
  const chunks = readPngChunks(pngBytes);

  for (const chunk of chunks) {
    if (chunk.type !== "tEXt" || !isCharaTextChunk(chunk.data)) {
      continue;
    }

    const text = textDecoder.decode(chunk.data);
    const encoded = text.slice("chara".length + 1);
    const json = textDecoder.decode(base64ToUint8Array(encoded));
    return JSON.parse(json) as CharacterCardV2;
  }

  return null;
}

type PngChunk = {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
};

function readPngChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;

    if (chunkEnd > bytes.length) {
      throw new Error("Invalid PNG chunk length.");
    }

    const type = textDecoder.decode(bytes.slice(typeStart, dataStart));
    chunks.push({
      type,
      data: bytes.slice(dataStart, dataEnd),
      raw: bytes.slice(offset, chunkEnd)
    });

    offset = chunkEnd;

    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

function createTextChunk(keyword: string, value: string): Uint8Array {
  const type = textEncoder.encode("tEXt");
  const data = textEncoder.encode(`${keyword}\0${value}`);
  const length = new Uint8Array(4);
  writeUint32(length, 0, data.length);
  const crcInput = concat([type, data]);
  const crcBytes = new Uint8Array(4);
  writeUint32(crcBytes, 0, crc32(crcInput));
  return concat([length, type, data, crcBytes]);
}

function isCharaTextChunk(data: Uint8Array): boolean {
  const text = textDecoder.decode(data.slice(0, Math.min(data.length, 16)));
  return text.startsWith("chara\0");
}

function assertPng(bytes: Uint8Array) {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error("Invalid PNG file.");
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("Invalid PNG signature.");
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
