import { createHash } from "node:crypto";
import { DENSITY, GRID_H, GRID_W, GUTTER } from "./config";
import { wordMask } from "./font";

export const CELLS = GRID_W * GRID_H;
/** Rows are byte aligned, so one row always starts on a byte boundary. */
export const ROW_BYTES = Math.ceil(GRID_W / 8);
export const BIT_BYTES = GRID_H * ROW_BYTES;

export function emptyBits(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(BIT_BYTES);
}

export function getBit(bits: Uint8Array, x: number, y: number): number {
    return (bits[y * ROW_BYTES + (x >> 3)] >> (x & 7)) & 1;
}

function setBit(bits: Uint8Array, x: number, y: number, value: number): void {
    const i = y * ROW_BYTES + (x >> 3);
    if (value) {
        bits[i] |= 1 << (x & 7);
    } else {
        bits[i] &= ~(1 << (x & 7));
    }
}

export const word = wordMask();
export const wordX = Math.floor((GRID_W - word.w) / 2);
export const wordY = Math.floor((GRID_H - word.h) / 2);

/**
 * Cells that may be alive. Everything inside the word's box plus one gutter is
 * dead by construction and never counted as a neighbour.
 */
export const allowed: Uint8Array = (() => {
    const ok = new Uint8Array(CELLS).fill(1);
    const x0 = Math.max(0, wordX - GUTTER);
    const y0 = Math.max(0, wordY - GUTTER);
    const x1 = Math.min(GRID_W, wordX + word.w + GUTTER);
    const y1 = Math.min(GRID_H, wordY + word.h + GUTTER);
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            ok[y * GRID_W + x] = 0;
        }
    }
    return ok;
})();

export function randomBits(): Uint8Array<ArrayBuffer> {
    const bits = new Uint8Array(BIT_BYTES);
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            if (allowed[y * GRID_W + x] && Math.random() < DENSITY) {
                setBit(bits, x, y, 1);
            }
        }
    }
    return bits;
}

/** One generation of B3/S23 on a one-cell padded copy: no bounds checks inside. */
export function step(bits: Uint8Array): Uint8Array<ArrayBuffer> {
    const w = GRID_W + 2;
    const pad = new Uint8Array((GRID_H + 2) * w);
    for (let y = 0; y < GRID_H; y++) {
        const src = y * ROW_BYTES;
        const dst = (y + 1) * w + 1;
        const row = bits.subarray(src, src + ROW_BYTES);
        for (let x = 0; x < GRID_W; x++) {
            pad[dst + x] = (row[x >> 3] >> (x & 7)) & 1;
        }
    }

    const next = new Uint8Array(BIT_BYTES);
    for (let y = 1; y <= GRID_H; y++) {
        const base = y * w;
        const outRow = (y - 1) * ROW_BYTES;
        for (let x = 1; x <= GRID_W; x++) {
            if (allowed[(y - 1) * GRID_W + (x - 1)] === 0) {
                continue;
            }
            const n =
                pad[base - w + x - 1] + pad[base - w + x] + pad[base - w + x + 1] +
                pad[base + x - 1] + pad[base + x + 1] +
                pad[base + w + x - 1] + pad[base + w + x] + pad[base + w + x + 1];
            const alive = pad[base + x];
            if (n === 3 || (n === 2 && alive === 1)) {
                const i = outRow + ((x - 1) >> 3);
                next[i] |= 1 << ((x - 1) & 7);
            }
        }
    }
    return next;
}

export function hashBits(bits: Uint8Array<ArrayBuffer>): string {
    return createHash("sha256").update(bits).digest("hex");
}
