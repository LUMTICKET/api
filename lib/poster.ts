/**
 * Event poster / flyer helpers.
 *
 * Business owners upload a poster from the business dashboard. The browser
 * resizes it and sends it as a data URL (data:image/jpeg;base64,...), which is
 * stored in `events.image`. Public clients never receive the raw data URL in
 * list responses; they get a small `/api/events/:id/poster` URL instead, which
 * is cacheable and keeps catalog payloads light.
 */

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Max decoded poster size (bytes). The dashboard compresses well below this. */
export const MAX_POSTER_BYTES = 1_500_000;

export type PosterCheck = { ok: true; value: string | null } | { ok: false; error: string };

/** Validate the `image` field of a create/update request. null/"" clears the poster. */
export function validatePoster(input: unknown): PosterCheck {
  if (input === null || input === "") return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, error: "image must be a string" };

  if (/^https:\/\//i.test(input)) {
    if (input.length > 2000) return { ok: false, error: "image URL is too long" };
    return { ok: true, value: input };
  }

  const match = DATA_URL.exec(input);
  if (!match) return { ok: false, error: "Poster must be a JPEG, PNG or WebP image" };
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_POSTER_BYTES) {
    return { ok: false, error: "Poster is too large. Please upload an image under 1.5 MB." };
  }
  return { ok: true, value: input };
}

export function isDataUrl(value: string | null | undefined): value is string {
  return !!value && value.startsWith("data:image/");
}

/** The value API clients should see for an event's poster. */
export function publicPosterUrl(eventId: number, image: string | null, version?: Date | string | null) {
  if (!image) return null;
  if (!isDataUrl(image)) return image;
  const v = version ? new Date(version).getTime() : 0;
  return `/api/events/${eventId}/poster?v=${v}`;
}

export function decodeDataUrl(value: string): { contentType: string; bytes: Buffer } | null {
  const match = DATA_URL.exec(value);
  if (!match) return null;
  return { contentType: match[1], bytes: Buffer.from(match[2], "base64") };
}
