export const STORAGE_PORT = Symbol('STORAGE_PORT');

export interface UploadFileParams {
  key: string;
  contentType: string;
  body: Buffer;
}

export interface UploadFileResult {
  url: string;
}

/** Abstração de storage de arquivos — troque a implementação (`LocalDiskStorageAdapter`)
 * por um adapter real de R2/S3 (S3-compatível) sem tocar em quem consome esta interface. */
export interface StoragePort {
  upload(params: UploadFileParams): Promise<UploadFileResult>;
}
