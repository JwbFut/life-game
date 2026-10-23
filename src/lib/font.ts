/**
 * Hand-drawn 5x7 / 5x5 bitmap type. One font pixel becomes `scale` cells, so the
 * word and the caption live on exactly the same grid as the simulation.
 */
import { WORD, WORD_GAP, WORD_SCALE } from "./config";

type Glyph = string[];

const WORD_FONT: Record<string, Glyph> = {
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    I: ["1", "1", "1", "1", "1", "1", "1"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
};

export interface Mask {
    w: number;
    h: number;
    cells: Uint8Array;
}

export function layout(text: string, font: Record<string, Glyph>, scale: number, gap: number): Mask {
    const glyphs = [...text].map((ch) => font[ch] ?? font[" "]);
    const widths = glyphs.map((g) => g[0].length * scale);
    const h = Math.max(...glyphs.map((g) => g.length)) * scale;
    const w = widths.reduce((a, b) => a + b, 0) + gap * scale * Math.max(0, glyphs.length - 1);
    const cells = new Uint8Array(w * h);
    let x = 0;
    glyphs.forEach((glyph, gi) => {
        const gw = glyph[0].length;
        glyph.forEach((row, y) => {
            [...row].forEach((bit, gx) => {
                if (bit !== "1") return;
                for (let dy = 0; dy < scale; dy++) {
                    for (let dx = 0; dx < scale; dx++) {
                        const px = x + gx * scale + dx;
                        const py = y * scale + dy;
                        cells[py * w + px] = 1;
                    }
                }
            });
        });
        x += gw * scale + (gi < glyphs.length - 1 ? gap * scale : 0);
    });
    return { w, h, cells };
}

export const wordMask = () => layout(WORD, WORD_FONT, WORD_SCALE, WORD_GAP);
