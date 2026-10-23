import { CAPTION_DELAY_CS } from "./config";
import { assemble, blockFor, blockFromCells } from "./gif";
import { renderFrame } from "./render";

type Block = Uint8Array<ArrayBuffer>;

interface Head {
    block: Block;
    hash: string;
}

interface Delta {
    block: Block;
    prev: string;
    hash: string;
}

interface Caption {
    block: Block;
    hash: string;
}

/**
 * Encoded blocks live in this process only, and every entry carries the hashes
 * of the frames it was built from. A hit is therefore always valid, even if the
 * chain was rewritten by someone else.
 */
const heads = new Map<bigint, Head>();
const deltas = new Map<bigint, Delta>();
const captions = new Map<bigint, Caption>();

function trim(store: Map<bigint, unknown>, start: bigint): void {
    for (const key of store.keys()) {
        if (key < start - 4n) {
            store.delete(key);
        }
    }
}

export function buildGif(
    theme: "dark" | "light",
    start: bigint,
    bits: Uint8Array<ArrayBuffer>[],
    hashes: string[],
): Uint8Array<ArrayBuffer> {
    const blocks: Block[] = [];

    // the head is the only full canvas and carries the word
    let head = heads.get(start);
    if (!head || head.hash !== hashes[0]) {
        head = { block: blockFor(null, renderFrame(bits[0])), hash: hashes[0] };
        heads.clear();
        heads.set(start, head);
    }
    blocks.push(head.block);

    for (let i = 1; i < bits.length; i++) {
        const t = start + BigInt(i);
        let delta = deltas.get(t);
        if (!delta || delta.prev !== hashes[i - 1] || delta.hash !== hashes[i]) {
            delta = {
                block: blockFromCells(bits[i - 1], bits[i]),
                prev: hashes[i - 1],
                hash: hashes[i],
            };
            deltas.set(t, delta);
        }
        blocks.push(delta.block);
    }

    const last = start + BigInt(bits.length - 1);
    const tail = bits[bits.length - 1];
    let caption = captions.get(last);
    if (!caption || caption.hash !== hashes[hashes.length - 1]) {
        caption = {
            block: blockFor(renderFrame(tail), renderFrame(tail, true), CAPTION_DELAY_CS),
            hash: hashes[hashes.length - 1],
        };
        captions.clear();
        captions.set(last, caption);
    }
    blocks.push(caption.block);

    trim(deltas, start);
    return assemble(blocks, theme);
}
