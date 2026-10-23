import assert from "node:assert/strict";
import { test } from "node:test";
import { lzw } from "../src/lib/gif";

/** Straight GIF-LZW decoder, only good enough to check the encoder. */
function decode(data: Uint8Array, minCodeSize: number): number[] {
    const CLEAR = 1 << minCodeSize;
    const END = CLEAR + 1;
    let size = minCodeSize + 1;
    let dict = buildDict(CLEAR);
    let next = END + 1;
    let prev: number[] | null = null;
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    let pos = 0;

    while (true) {
        while (bits < size) {
            if (pos >= data.length) return out;
            acc |= data[pos++] << bits;
            bits += 8;
        }
        const code = acc & ((1 << size) - 1);
        acc >>>= size;
        bits -= size;

        if (code === CLEAR) {
            dict = buildDict(CLEAR);
            next = END + 1;
            size = minCodeSize + 1;
            prev = null;
            continue;
        }
        if (code === END) return out;

        let entry: number[];
        if (code < next) {
            entry = dict[code];
        } else if (prev) {
            entry = [...prev, prev[0]];
        } else {
            throw new Error(`bad code ${code}`);
        }
        out.push(...entry);
        if (prev && next < 4096) {
            dict[next++] = [...prev, entry[0]];
            if (next === 1 << size && size < 12) size++;
        }
        prev = entry;
    }
}

function buildDict(clear: number): number[][] {
    const dict: number[][] = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    return dict;
}

test("lzw round-trips a shrinking alphabet", () => {
    for (const length of [1, 2, 17, 4096, 280608]) {
        const pixels = new Uint8Array(length);
        for (let i = 0; i < length; i++) pixels[i] = i % 4 === 0 ? 1 : 3;
        const decoded = decode(lzw(pixels, 2), 2);
        assert.equal(decoded.length, length);
        assert.deepEqual(Uint8Array.from(decoded), pixels);
    }
});

test("lzw survives a full dictionary and a clear", () => {
    const pixels = new Uint8Array(280608);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 4;
    const decoded = decode(lzw(pixels, 2), 2);
    assert.deepEqual(Uint8Array.from(decoded), pixels);
});
