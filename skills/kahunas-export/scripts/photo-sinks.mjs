// Where progress photos go during an export.
//
// Kahunas photo links are S3 URLs signed for 15 minutes, so a photo has to be copied
// while the export runs. A "sink" receives each photo right after its link is read.
//
// Configure with --photos-to (or AC_KAHUNAS_PHOTOS_TO):
//
//   local                      save into the export folder (export/media/photos/...)
//   s3://bucket[/prefix]       upload to S3 using the standard AWS credential chain
//
// S3 options (flags or environment variables):
//
//   --s3-region   / AC_KAHUNAS_S3_REGION   (else AWS_REGION / profile default)
//   --s3-profile  / AC_KAHUNAS_S3_PROFILE  (else AWS_PROFILE / default profile)
//   --s3-endpoint / AC_KAHUNAS_S3_ENDPOINT for S3-compatible storage (path-style)
//
// To add another destination (for example MSB presigned upload URLs), implement
// { describe(), async exists(key), async put(key, body, meta) } and register it in
// createPhotoSink.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "./lib.mjs";

export async function createPhotoSink(args, exportDir) {
  const target = args["photos-to"] || process.env.AC_KAHUNAS_PHOTOS_TO || (args["download-photos"] ? "local" : "");
  if (!target) {
    return null;
  }
  if (target === "local") {
    return localSink(exportDir);
  }
  if (/^s3:\/\//i.test(target)) {
    return await s3Sink(target, {
      region: args["s3-region"] || process.env.AC_KAHUNAS_S3_REGION,
      profile: args["s3-profile"] || process.env.AC_KAHUNAS_S3_PROFILE,
      endpoint: args["s3-endpoint"] || process.env.AC_KAHUNAS_S3_ENDPOINT
    });
  }
  throw new Error(`Unknown photo destination "${target}". Use "local" or "s3://bucket/prefix".`);
}

function localSink(exportDir) {
  return {
    kind: "local",
    describe: () => "this laptop (inside the export folder)",
    location: (key) => `media/photos/${key}`,
    async exists(key) {
      return existsSync(join(exportDir, "media", "photos", key));
    },
    async put(key, body) {
      const path = join(exportDir, "media", "photos", key);
      ensureDir(join(path, ".."));
      writeFileSync(path, body);
    }
  };
}

async function s3Sink(target, options) {
  const match = target.match(/^s3:\/\/([^/]+)\/?(.*)$/i);
  if (!match) {
    throw new Error(`Invalid S3 destination "${target}". Expected s3://bucket/prefix.`);
  }
  const bucket = match[1];
  const prefix = match[2].replace(/^\/+|\/+$/g, "");
  let sdk;
  try {
    sdk = await import("@aws-sdk/client-s3");
  } catch {
    throw new Error("Uploading photos to S3 needs the @aws-sdk/client-s3 package. Run npm install in the exporter folder.");
  }
  const clientConfig = {};
  if (options.region) {
    clientConfig.region = options.region;
  }
  if (options.endpoint) {
    clientConfig.endpoint = options.endpoint;
    clientConfig.forcePathStyle = true;
  }
  if (options.profile) {
    // The SDK's default credential chain reads AWS_PROFILE (shared config, SSO, etc.).
    process.env.AWS_PROFILE = options.profile;
  }
  const client = new sdk.S3Client(clientConfig);
  const fullKey = (key) => (prefix ? `${prefix}/${key}` : key);

  // Fail fast with a clear message if the bucket or credentials are wrong.
  try {
    await client.send(new sdk.HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    throw new Error(`Cannot reach S3 bucket "${bucket}": ${error.name || ""} ${error.message || ""}`.trim());
  }

  return {
    kind: "s3",
    describe: () => `S3 bucket ${bucket}${prefix ? `/${prefix}` : ""}`,
    location: (key) => `s3://${bucket}/${fullKey(key)}`,
    async exists(key) {
      try {
        await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: fullKey(key) }));
        return true;
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
          return false;
        }
        throw error;
      }
    },
    async put(key, body, meta = {}) {
      await client.send(new sdk.PutObjectCommand({
        Bucket: bucket,
        Key: fullKey(key),
        Body: body,
        ContentType: meta.contentType,
        Metadata: Object.fromEntries(Object.entries(meta.metadata || {}).filter(([, value]) => value !== undefined && value !== null).map(([k, value]) => [k, String(value)]))
      }));
    }
  };
}
