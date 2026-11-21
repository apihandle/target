/**
 * Video Maker limits shared by the server (lib/server/videoRender.ts, which re-exports these)
 * and the client card — kept in their own module so the browser bundle never pulls in server code.
 */
export const VIDEO_MIN_SLIDES = 3;
export const VIDEO_MAX_SLIDES = 6;
export const VIDEO_CAPTION_MAX = 90;
