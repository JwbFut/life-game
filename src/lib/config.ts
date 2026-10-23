/** Geometry of one plate: 237 x 74 cells, painted at 4 device pixels per cell. */
export const GRID_W = 237;
export const GRID_H = 74;
export const CELL = 4;
export const PX_W = GRID_W * CELL; // 948
export const PX_H = GRID_H * CELL; // 296

/** The word is ink, never cells: it is punched out of the field before it runs. */
export const WORD = "LIFE";
export const WORD_SCALE = 5;
export const WORD_GAP = 2;
export const GUTTER = 8;

export const DENSITY = 0.13;
/** Duplicate detection cadence, in frames. */
export const HASH_EVERY = 10;

export const FRAME_DELAY_CS = 100; // one second per generation
/** The frozen closing frame lingers, so the end is unmistakable. */
export const CAPTION_DELAY_CS = 300;
/** Frames older than a minute are dropped. */
export const FRAME_TTL_SECONDS = 60;
/** An encoded GIF is reused for one second. */
export const GIF_CACHE_MS = 1000;

/**
 * Database lease. The TTL must stay comfortably above the slowest generation
 * (a cold chain is ~2 s, a partial top-up is at most 180 frames); the waiter
 * gives up a little before that so the request fails loudly rather than hanging.
 */
export const LOCK_TTL_MS = 30_000;
export const LOCK_WAIT_MS = 20_000;
export const LOCK_POLL_MS = 100;

/**
 * How many frames fit in roughly one megabyte of GIF (measured, see README).
 * Bump only together with a fresh measurement.
 */
export const BUDGET_FRAMES = 180;
/**
 * How far ahead the chain is kept: 180 served + 180 spare. No request ever
 * generates more than BUDGET_FRAMES new frames at once.
 */
export const CHAIN_FRAMES = 360;

export type ThemeName = "dark" | "light";

export const THEMES: Record<ThemeName, { bg: [number, number, number]; fg: [number, number, number] }> = {
    dark: { bg: [0x0d, 0x11, 0x17], fg: [0xe6, 0xed, 0xf3] },
    light: { bg: [0xff, 0xff, 0xff], fg: [0x16, 0x1b, 0x22] },
};
