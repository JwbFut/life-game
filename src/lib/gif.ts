import { CELL, FRAME_DELAY_CS, GRID_H, GRID_W, PX_H, PX_W, THEMES, type ThemeName } from "./config";
import { getBit } from "./life";

/** Palette index 3 doubles as "unchanged" for delta frames. */
const TRANSPARENT = 3;

/**
 * Small open-addressed dictionary. It has to stay in cache: a 1 M-entry table
 * measured slower than this 64 KB one purely on cache misses.
 */
const TABLE_SIZE = 1 << 14;
const KEYS = new Int32Array(TABLE_SIZE);
const CODES = new Int32Array(TABLE_SIZE);

/** Growable byte buffer; `number[]` costs a boxed number per byte. */
class ByteSink {
    private buffer = new Uint8Array(4096);
    private length = 0;

    push(byte: number): void {
        if (this.length === this.buffer.length) {
            const grown = new Uint8Array(this.buffer.length * 2);
            grown.set(this.buffer);
            this.buffer = grown;
        }
        this.buffer[this.length++] = byte & 0xff;
    }

    short(value: number): void {
        this.push(value);
        this.push(value >> 8);
    }

    bytes(): Uint8Array<ArrayBuffer> {
        return this.buffer.slice(0, this.length);
    }
}

/**
 * GIF LZW with an open-addressed table: rebuilding a sliding window costs one
 * full-frame pass per second, so this has to be quick.
 */
export function lzw(pixels: Uint8Array, minCodeSize: number): Uint8Array<ArrayBuffer> {
    const CLEAR = 1 << minCodeSize;
    const END = CLEAR + 1;
    let codeSize = minCodeSize + 1;
    let free = END + 1;
    const mask = TABLE_SIZE - 1;
    KEYS.fill(-1);

    const out = new ByteSink();
    let acc = 0;
    let accBits = 0;

    acc |= CLEAR << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
        out.push(acc);
        acc >>>= 8;
        accBits -= 8;
    }

    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
        const k = pixels[i];
        const key = (prefix << 8) | k;
        let slot = (key ^ (key >>> 8)) & mask;
        let hit = -1;
        while (KEYS[slot] !== -1) {
            if (KEYS[slot] === key) {
                hit = CODES[slot];
                break;
            }
            slot = (slot + 1) & mask;
        }
        if (hit >= 0) {
            prefix = hit;
            continue;
        }

        acc |= prefix << accBits;
        accBits += codeSize;
        while (accBits >= 8) {
            out.push(acc);
            acc >>>= 8;
            accBits -= 8;
        }

        if (free <= 4095) {
            KEYS[slot] = key;
            CODES[slot] = free++;
            // The decoder's table trails the encoder by one entry, so the wider
            // code size only applies one entry later than the naive limit.
            if (free >= (1 << codeSize) + 1 && codeSize < 12) {
                codeSize++;
            }
        } else {
            acc |= CLEAR << accBits;
            accBits += codeSize;
            while (accBits >= 8) {
                out.push(acc);
                acc >>>= 8;
                accBits -= 8;
            }
            KEYS.fill(-1);
            free = END + 1;
            codeSize = minCodeSize + 1;
        }
        prefix = k;
    }

    acc |= prefix << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
        out.push(acc);
        acc >>>= 8;
        accBits -= 8;
    }
    acc |= END << accBits;
    accBits += codeSize;
    while (accBits >= 8) {
        out.push(acc);
        acc >>>= 8;
        accBits -= 8;
    }
    if (accBits > 0) {
        out.push(acc);
    }
    return out.bytes();
}

function diffRect(prev: Uint8Array | null, frame: Uint8Array): [number, number, number, number] {
    if (!prev) {
        return [0, 0, PX_W, PX_H];
    }
    const words = PX_W / 4;
    const a = new Uint32Array(frame.buffer, frame.byteOffset, PX_W * PX_H / 4);
    const b = new Uint32Array(prev.buffer, prev.byteOffset, PX_W * PX_H / 4);
    let x0 = PX_W;
    let y0 = PX_H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < PX_H; y++) {
        const row = y * words;
        for (let x = 0; x < words; x++) {
            if (a[row + x] !== b[row + x]) {
                const left = x * 4;
                const right = left + 3;
                if (left < x0) x0 = left;
                if (right > x1) x1 = right;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) {
        return [0, 0, 1, 1];
    }
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** GCE + image descriptor + LZW payload for an already-built sub-image. */
function container(
    x: number,
    y: number,
    w: number,
    h: number,
    data: Uint8Array<ArrayBuffer>,
    delayCs = FRAME_DELAY_CS,
): Uint8Array<ArrayBuffer> {
    const out = new ByteSink();
    // disposal = keep, transparency on, delay in 1/100 s
    out.push(0x21);
    out.push(0xf9);
    out.push(0x04);
    out.push(0x05);
    out.short(delayCs);
    out.push(TRANSPARENT);
    out.push(0x00);

    out.push(0x2c);
    out.short(x);
    out.short(y);
    out.short(w);
    out.short(h);
    out.push(0x00);

    out.push(2);
    for (let i = 0; i < data.length; i += 255) {
        const n = Math.min(255, data.length - i);
        out.push(n);
        for (let j = 0; j < n; j++) {
            out.push(data[i + j]);
        }
    }
    out.push(0x00);
    return out.bytes();
}

/**
 * Delta of two cell grids, built straight from the bits — no full-canvas pixel
 * work. The word overlay is static and lives inside the masked box, so it never
 * appears in a delta.
 */
export function blockFromCells(prev: Uint8Array, cur: Uint8Array): Uint8Array<ArrayBuffer> {
    let x0 = GRID_W;
    let y0 = GRID_H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            if (getBit(prev, x, y) !== getBit(cur, x, y)) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }

    if (x1 < 0) {
        return container(0, 0, 1, 1, lzw(new Uint8Array(1).fill(TRANSPARENT), 2));
    }

    const w = (x1 - x0 + 1) * CELL;
    const h = (y1 - y0 + 1) * CELL;
    const sub = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const value = getBit(cur, x, y);
            if (value === getBit(prev, x, y)) {
                continue;
            }
            for (let dy = 0; dy < CELL; dy++) {
                const row = (y - y0) * CELL * w + (x - x0) * CELL + dy * w;
                sub.fill(value, row, row + CELL);
            }
        }
    }
    return container(x0 * CELL, y0 * CELL, w, h, lzw(sub, 2));
}

/**
 * Frame bytes from rendered pixels: used for the head (which carries the word)
 * and for the caption frame, which changes pixels no cell knows about.
 */
export function blockFor(
    prev: Uint8Array | null,
    frame: Uint8Array,
    delayCs = FRAME_DELAY_CS,
): Uint8Array<ArrayBuffer> {
    const [x, y, w, h] = diffRect(prev, frame);
    const sub = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
            const idx = (y + yy) * PX_W + (x + xx);
            const value = frame[idx];
            if (!prev || value !== prev[idx]) {
                sub[yy * w + xx] = value;
            }
        }
    }
    return container(x, y, w, h, lzw(sub, 2), delayCs);
}

/** Header, global colour table, then the given frame blocks. */
export function assemble(blocks: Uint8Array<ArrayBuffer>[], theme: ThemeName): Uint8Array<ArrayBuffer> {
    const { bg, fg } = THEMES[theme];
    const out = new ByteSink();
    for (const ch of "GIF89a") {
        out.push(ch.charCodeAt(0));
    }
    out.short(PX_W);
    out.short(PX_H);
    out.push(0xf1); // global colour table, 4 entries
    out.push(0);
    out.push(0);
    out.push(bg[0]);
    out.push(bg[1]);
    out.push(bg[2]);
    out.push(fg[0]);
    out.push(fg[1]);
    out.push(fg[2]);
    out.push(0);
    out.push(0);
    out.push(0);
    out.push(0);
    out.push(0);
    out.push(0);

    // No NETSCAPE2.0 loop extension on purpose: it plays exactly once, whereas
    // a loop count of 1 would play twice.

    const header = out.bytes();
    const total = header.length + blocks.reduce((n, b) => n + b.length, 0) + 1;
    const gif = new Uint8Array(total);
    let at = 0;
    gif.set(header, at);
    at += header.length;
    for (const b of blocks) {
        gif.set(b, at);
        at += b.length;
    }
    gif[at] = 0x3b;
    return gif;
}
