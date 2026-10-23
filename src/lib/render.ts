import { CELL, GRID_H, GRID_W, PX_H, PX_W } from "./config";
import { CAPTION_HEIGHT, CAPTION_ROWS, CAPTION_WIDTH } from "./caption";
import { getBit, word, wordX, wordY } from "./life";

const wordW = word.w * CELL;
const wordH = word.h * CELL;
/** The word never moves, and its box holds no cells, so it is blitted as one strip. */
const WORD_PX: Uint8Array = (() => {
    const strip = new Uint8Array(wordW * wordH);
    for (let y = 0; y < word.h; y++) {
        for (let x = 0; x < word.w; x++) {
            if (!word.cells[y * word.w + x]) continue;
            for (let dy = 0; dy < CELL; dy++) {
                for (let dx = 0; dx < CELL; dx++) {
                    strip[(y * CELL + dy) * wordW + x * CELL + dx] = 1;
                }
            }
        }
    }
    return strip;
})();

const captionX = Math.floor((PX_W - CAPTION_WIDTH) / 2);
const captionY = (wordY + word.h + 6) * CELL;

function fieldPixels(bits: Uint8Array): Uint8Array {
    const px = new Uint8Array(PX_W * PX_H);
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            if (getBit(bits, x, y) === 0) {
                continue;
            }
            const x0 = x * CELL;
            const y0 = y * CELL;
            for (let dy = 0; dy < CELL; dy++) {
                const at = (y0 + dy) * PX_W + x0;
                px.fill(1, at, at + CELL);
            }
        }
    }
    return px;
}

function blitWord(px: Uint8Array): void {
    const x = wordX * CELL;
    for (let r = 0; r < wordH; r++) {
        px.set(WORD_PX.subarray(r * wordW, (r + 1) * wordW), (wordY * CELL + r) * PX_W + x);
    }
}

function erase(x0: number, y0: number, w: number, h: number, px: Uint8Array): void {
    for (let y = y0; y < y0 + h; y++) {
        if (y < 0 || y >= PX_H) continue;
        px.fill(0, y * PX_W + x0, y * PX_W + x0 + w);
    }
}

/**
 * Paint one frame at 4 px per cell. `final` freezes the field, erases the
 * caption's own box and stamps the caption there.
 */
export function renderFrame(bits: Uint8Array, final = false): Uint8Array {
    const px = fieldPixels(bits);
    blitWord(px);
    if (!final) {
        return px;
    }
    erase(captionX - CELL, captionY - CELL, CAPTION_WIDTH + CELL * 2, CAPTION_HEIGHT + CELL * 2, px);
    for (let y = 0; y < CAPTION_HEIGHT; y++) {
        const row = CAPTION_ROWS[y];
        const off = (captionY + y) * PX_W + captionX;
        for (let x = 0; x < CAPTION_WIDTH; x++) {
            if (row[x] === "1") {
                px[off + x] = 1;
            }
        }
    }
    return px;
}
