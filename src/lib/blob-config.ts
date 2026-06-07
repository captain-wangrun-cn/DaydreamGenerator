export type BlobAuthOptions = {
  token?: string;
  oidcToken?: string;
  storeId?: string;
};

export const blobConfigErrorMessage =
  "直链功能还没有配置 Vercel Blob。请在环境变量中设置 BLOB_READ_WRITE_TOKEN，或设置 VERCEL_OIDC_TOKEN + BLOB_STORE_ID。";

export function getBlobAuthOptions(): BlobAuthOptions {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    return { token };
  }

  const oidcToken = process.env.VERCEL_OIDC_TOKEN?.trim();
  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (oidcToken && storeId) {
    return { oidcToken, storeId };
  }

  throw new Error(blobConfigErrorMessage);
}

export function formatBlobError(error: unknown): string {
  if (error instanceof Error && error.message.includes("No blob credentials found")) {
    return blobConfigErrorMessage;
  }

  return error instanceof Error ? error.message : "Unknown share error.";
}
