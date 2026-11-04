import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface WorkspaceLogoStorage {
  ready(): boolean;
  put(organizationId: string, version: string, bytes: Buffer): Promise<void>;
  get(organizationId: string, version: string): Promise<Uint8Array | undefined>;
  remove(organizationId: string, version: string): Promise<void>;
}

export function workspaceLogoStorageReady() {
  return !!process.env.INKSPECT_ASSETS_BUCKET?.trim();
}

let client: S3Client | undefined;
function storage() {
  const bucket = process.env.INKSPECT_ASSETS_BUCKET?.trim();
  if (!bucket) throw new Error("Workspace asset storage is not configured.");
  client ??= new S3Client({
    region: process.env.AWS_REGION || "eu-west-2",
    // Scope the local role to asset storage without changing Bedrock credentials.
    profile: process.env.INKSPECT_ASSETS_AWS_PROFILE?.trim() || undefined,
  });
  return { client, bucket };
}

function key(organizationId: string, version: string) {
  return `workspace-logos/${createHash("sha256").update(organizationId).digest("hex")}/${version}.webp`;
}

export const workspaceLogoStorage: WorkspaceLogoStorage = {
  ready: workspaceLogoStorageReady,
  async put(organizationId, version, bytes) {
    const { client, bucket } = storage();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key(organizationId, version), Body: bytes, ContentType: "image/webp", ServerSideEncryption: "AES256" }));
  },
  async get(organizationId, version) {
    const { client, bucket } = storage();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(organizationId, version) }));
      return await result.Body?.transformToByteArray();
    } catch (error) {
      if (error instanceof Error && error.name === "NoSuchKey") return undefined;
      throw error;
    }
  },
  async remove(organizationId, version) {
    const { client, bucket } = storage();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(organizationId, version) }));
  },
};
