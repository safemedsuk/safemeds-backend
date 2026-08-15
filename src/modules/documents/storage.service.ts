import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'crypto'

import { EnvConfig } from '../../config/env.validation'

export interface PutObjectResult {
  key: string
  sha256: string
  sizeBytes: number
}

export interface VerifiedObject {
  sha256: string
  sizeBytes: number
}

/**
 * S3-compatible storage over Cloudflare R2. Pulled forward from Phase 8.1
 * because Phase 1.2 (licence upload) has no other dependencies and needs
 * it immediately. Swapping to AWS S3 later is config-only (same client,
 * different endpoint).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(configService: ConfigService<EnvConfig, true>) {
    this.bucket = configService.get('R2_BUCKET_NAME', { infer: true })

    this.client = new S3Client({
      region: 'auto',
      endpoint: configService.get('R2_ENDPOINT', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: configService.get('R2_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: configService.get('R2_SECRET_ACCESS_KEY', { infer: true }),
      },
    })
  }

  /**
   * Direct backend-to-R2 upload for small server-received files (e.g. the
   * licence document, which the client sends to us as multipart, not
   * directly to R2) — as opposed to `presignUpload`, which is for the
   * client-uploads-directly-to-R2 pattern the rest of the Documents module
   * (Phase 8) uses.
   */
  async putObject(key: string, body: Buffer, contentType: string): Promise<PutObjectResult> {
    const sha256 = createHash('sha256').update(body).digest('hex')

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )

    return { key, sha256, sizeBytes: body.byteLength }
  }

  presignDownload(key: string, ttlSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key })
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
  }

  /**
   * Client-uploads-directly-to-R2 pattern (Phase 8's Documents module) —
   * the backend never sees the file bytes for these, only registers the
   * intent and hands back a URL the browser PUTs straight to R2. Caller
   * supplies `maxSizeBytes` for its own pre-upload UI validation only;
   * R2/S3 presigned PUT URLs can't enforce a size cap server-side the way
   * a POST policy could, so `complete()`'s server-side re-download is the
   * real integrity/size backstop, not this parameter.
   */
  presignUpload(key: string, contentType: string, ttlSeconds: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    })
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
  }

  /**
   * Re-downloads the object and hashes it server-side — the whole point
   * being that a client-reported sha256 is never trusted on its own.
   * Throws if the object doesn't exist (e.g. the client never actually
   * completed the presigned PUT).
   */
  async verifyObject(key: string): Promise<VerifiedObject> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const bytes = await result.Body!.transformToByteArray()
    return { sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.byteLength }
  }

  /**
   * Real-usage feedback, 19 Aug 2026 — the actual bytes, for a caller that
   * needs to embed the object directly (e.g. `RegulatorySubmissionPdfService`
   * drawing an uploaded regulatory-authority emblem into a generated PDF),
   * not just verify or presign it.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const bytes = await result.Body!.transformToByteArray()
    return Buffer.from(bytes)
  }
}
