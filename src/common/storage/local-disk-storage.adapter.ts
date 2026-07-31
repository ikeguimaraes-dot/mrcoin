import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { StoragePort, UploadFileParams, UploadFileResult } from './storage.port';

/** Stub de dev: grava em disco local (`LOCAL_STORAGE_DIR`) em vez de subir pra R2/S3 de
 * verdade. Nenhum provedor real integrado ainda — trocar por um S3StorageAdapter
 * (R2 é S3-compatível) é uma tarefa isolada, sem mudar quem consome StoragePort. */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async upload(params: UploadFileParams): Promise<UploadFileResult> {
    const baseDir = this.config.get('LOCAL_STORAGE_DIR', { infer: true });
    const filePath = join(baseDir, params.key);

    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, params.body);

    return { url: `local://${params.key}` };
  }
}
