import type { MediaAttachment } from "@/lib/llm/types";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 24 * 1024 * 1024;
export const SHARE_MAX_BYTES = 16 * 1024 * 1024;

export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

export function dataUrlToMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1] ?? "application/octet-stream";
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function filesToAttachments(files: FileList | File[]): Promise<MediaAttachment[]> {
  const list = Array.from(files);
  const attachments: MediaAttachment[] = [];

  for (const file of list) {
    const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
    if (!kind) {
      continue;
    }

    if (kind === "image" && file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} 超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 图片限制。`);
    }

    if (kind === "video" && file.size > MAX_VIDEO_BYTES) {
      throw new Error(`${file.name} 超过 ${MAX_VIDEO_BYTES / 1024 / 1024}MB 视频限制。`);
    }

    attachments.push({
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || (kind === "image" ? "image/png" : "video/mp4"),
      kind,
      dataUrl: await fileToDataUrl(file),
      size: file.size
    });
  }

  return attachments;
}

const MEDIA_DB_NAME = "daydream-generator-media";
const MEDIA_DB_VERSION = 1;
const MEDIA_STORE_NAME = "media";

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        db.createObjectStore(MEDIA_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMediaToStore(key: string, media: MediaAttachment[]): Promise<void> {
  try {
    const db = await openMediaDb();
    const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
    tx.objectStore(MEDIA_STORE_NAME).put(media, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort: don't crash the app if IndexedDB is unavailable
  }
}

export async function loadMediaFromStore(key: string): Promise<MediaAttachment[]> {
  try {
    const db = await openMediaDb();
    const tx = db.transaction(MEDIA_STORE_NAME, "readonly");
    const request = tx.objectStore(MEDIA_STORE_NAME).get(key);
    const result = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!Array.isArray(result)) return [];
    return result.filter((item): item is MediaAttachment =>
      typeof item === "object" && item !== null
      && typeof (item as MediaAttachment).id === "string"
      && typeof (item as MediaAttachment).name === "string"
      && typeof (item as MediaAttachment).mimeType === "string"
      && ((item as MediaAttachment).kind === "image" || (item as MediaAttachment).kind === "video")
      && typeof (item as MediaAttachment).dataUrl === "string"
      && typeof (item as MediaAttachment).size === "number"
    );
  } catch {
    return [];
  }
}

export async function clearMediaStore(key: string): Promise<void> {
  try {
    const db = await openMediaDb();
    const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
    tx.objectStore(MEDIA_STORE_NAME).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort
  }
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}
