import { z } from "zod";

/**
 * Maximum decoded size for an uploaded image, in bytes. A 1600px JPEG at ~88%
 * quality sits comfortably under this. The cap exists to stop a client from
 * forcing the server to buffer huge payloads in memory: the JSON body parser
 * holds the entire base64 string before this validator ever runs, so the only
 * effective ceiling on the public surface is this schema plus the route's body
 * limit (see index.ts).
 */
export const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB decoded

// Accepted image types. This intentionally mirrors what the installed mobile
// clients actually send (iOS photos are HEIC by default; some upload paths
// forward the original file without re-encoding), so tightening the server
// does not reject real users. Cloudinary normalizes all of these server-side.
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;
type AllowedMime = (typeof ALLOWED_MIME)[number];

// Only a fixed set of base64 image data URIs is accepted. An arbitrary
// `data:image/...` prefix is NOT enough — the type must be one we support and
// the payload must be valid base64.
const DATA_URI_RE =
  /^data:(image\/(?:jpeg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Verify the decoded bytes actually begin with the declared format's magic
 * bytes. Without this, an attacker can label arbitrary junk as `image/jpeg`
 * and slip it past a prefix-only check; the bytes never reach Cloudinary as a
 * real image but the server still pays the decode/round-trip cost.
 */
function magicBytesMatch(mime: AllowedMime, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  switch (mime) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case "image/webp":
      return (
        buf.toString("ascii", 0, 4) === "RIFF" &&
        buf.toString("ascii", 8, 12) === "WEBP"
      );
    case "image/gif":
      // GIF87a / GIF89a both begin with "GIF8".
      return buf.toString("ascii", 0, 4) === "GIF8";
    case "image/heic":
    case "image/heif":
      // HEIF-family files carry an ISO base-media "ftyp" box at bytes 4-7.
      return buf.toString("ascii", 4, 8) === "ftyp";
  }
}

/**
 * Zod schema for a base64 image data URI. Enforces:
 *  - the exact `data:image/(jpeg|png|webp);base64,` shape (no spoofable prefix),
 *  - a cheap base64-length ceiling so oversized payloads are rejected before
 *    they are decoded,
 *  - a decoded-byte ceiling (default 12 MB),
 *  - a magic-byte match so the declared MIME cannot lie about the payload.
 *
 * Use directly inside a route's Zod body schema, e.g.
 *   z.object({ image: imageDataUri() })
 * so the existing `validate()` middleware rejects bad uploads at the boundary.
 */
export function imageDataUri(maxBytes: number = DEFAULT_MAX_IMAGE_BYTES) {
  // base64 encodes 3 bytes into 4 chars; add headroom for the data-URI prefix.
  const maxStringLen = Math.ceil(maxBytes / 3) * 4 + 64;
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  return z
    .string()
    .min(1, "Image data is required")
    .max(maxStringLen, `Image is too large (limit ${maxMb}MB)`)
    .superRefine((val, ctx) => {
      const match = DATA_URI_RE.exec(val);
      if (!match) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Must be a base64 data URI of type image/jpeg, image/png, or image/webp",
        });
        return;
      }

      const mime = match[1] as AllowedMime;
      const buf = Buffer.from(match[2], "base64");

      if (buf.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Image data is empty",
        });
        return;
      }
      if (buf.length > maxBytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Image exceeds the ${maxMb}MB limit`,
        });
        return;
      }
      if (!magicBytesMatch(mime, buf)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Image content does not match its declared format",
        });
      }
    });
}
