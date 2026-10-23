import { GIF_CACHE_MS } from "./config";

export interface Built {
    start: bigint;
    gif: Uint8Array<ArrayBuffer>;
    builtAt: number;
}

const cache = new Map<string, Built>();
const inflight = new Map<string, Promise<Built>>();

/**
 * One lock per theme: whoever gets here first fetches the frames and encodes
 * them, everyone else in that second waits for the same result.
 */
export function gifFor(
    theme: string,
    build: () => Promise<{ start: bigint; gif: Uint8Array<ArrayBuffer> }>,
): Promise<Built> {
    const hit = cache.get(theme);
    if (hit && Date.now() - hit.builtAt < GIF_CACHE_MS) {
        return Promise.resolve(hit);
    }
    const running = inflight.get(theme);
    if (running) {
        return running;
    }
    const job = build()
        .then((built) => {
            const entry: Built = { ...built, builtAt: Date.now() };
            cache.set(theme, entry);
            return entry;
        })
        .finally(() => {
            inflight.delete(theme);
        });
    inflight.set(theme, job);
    return job;
}
