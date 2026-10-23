import assert from "node:assert/strict";
import { test } from "node:test";
import { GRID_H, GRID_W } from "../src/lib/config";
import { allowed, getBit, randomBits, step } from "../src/lib/life";

const ROW_BYTES = Math.ceil(GRID_W / 8);
const BIT_BYTES = GRID_H * ROW_BYTES;

/** Deliberately naive B3/S23, written straight from the rule. */
function reference(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(BIT_BYTES);
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            if (!allowed[y * GRID_W + x]) continue;
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const xx = x + dx;
                    const yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= GRID_W || yy >= GRID_H) continue;
                    n += getBit(input, xx, yy);
                }
            }
            if (n === 3 || (n === 2 && getBit(input, x, y))) {
                const i = y * ROW_BYTES + (x >> 3);
                out[i] |= 1 << (x & 7);
            }
        }
    }
    return out;
}

test("step matches the naive rule for 25 generations", () => {
    let bits = randomBits();
    for (let generation = 0; generation < 25; generation++) {
        const expected = reference(bits);
        const actual = step(bits);
        assert.deepEqual(actual, expected, `diverged at generation ${generation + 1}`);
        bits = actual;
    }
});

test("the word box and its gutter stay dead", () => {
    let bits = randomBits();
    for (let i = 0; i < 10; i++) bits = step(bits);
    for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
            if (!allowed[y * GRID_W + x]) {
                assert.equal(getBit(bits, x, y), 0, `cell ${x},${y} inside the hole is alive`);
            }
        }
    }
});
