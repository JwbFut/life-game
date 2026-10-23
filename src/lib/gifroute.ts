import { BUDGET_FRAMES, type ThemeName } from "@/lib/config";
import { ensureRun, nowSeconds, prune, readRun } from "@/lib/frames";
import { buildGif } from "@/lib/gifbuild";
import { gifFor } from "@/lib/gifcache";

/** Pruning is a write; once every ten seconds is enough for a 60 s window. */
const PRUNE_EVERY_S = 10n;
let lastPrune = 0n;

async function loadWindow(): Promise<{
    start: bigint;
    bits: Uint8Array<ArrayBuffer>[];
    hashes: string[];
}> {
    const now = nowSeconds();
    if (now - lastPrune >= PRUNE_EVERY_S) {
        lastPrune = now;
        await prune(now);
    }

    // The chain stamps itself after generation, so this is the second it starts at.
    const start = await ensureRun(now);
    const frames = await readRun(start, BUDGET_FRAMES);
    if (frames.length !== BUDGET_FRAMES) {
        throw new Error(`chain incomplete: ${frames.length}/${BUDGET_FRAMES}`);
    }
    return {
        start,
        bits: frames.map((frame) => frame.bits),
        hashes: frames.map((frame) => frame.hash),
    };
}

export async function gifResponse(theme: ThemeName): Promise<Response> {
    const built = await gifFor(theme, async () => {
        const { start, bits, hashes } = await loadWindow();
        return { start, gif: buildGif(theme, start, bits, hashes) };
    });

    return new Response(new Blob([built.gif], { type: "image/gif" }), {
        headers: {
            "content-type": "image/gif",
            "content-length": String(built.gif.length),
            "cache-control": "public, max-age=1",
            "x-life-start": String(built.start),
        },
    });
}
