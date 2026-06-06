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
