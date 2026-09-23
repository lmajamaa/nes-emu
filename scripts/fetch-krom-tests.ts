// Regenerates test/data/krom/krom.bundle.gz: downloads krom's (Peter Lemon's) SNES test ROMs
// and their reference screenshots, listed in test/snes/krom-cases.ts, and bundles them into one
// gzipped file. See test/data/README.md.
//
// Usage: bun scripts/fetch-krom-tests.ts

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { packBundle } from '../test/snes/bundle';
import { KROM_BUNDLE, KROM_CASES, referenceOf } from '../test/snes/krom-cases';

const BASE_URL = 'https://raw.githubusercontent.com/PeterLemon/SNES/master/';

if (import.meta.main) {
    const files = new Map<string, Uint8Array>();
    for (const testCase of KROM_CASES) {
        for (const path of [testCase.rom, referenceOf(testCase)]) {
            const response = await fetch(BASE_URL + path.split('/').map(encodeURIComponent).join('/'));
            if (!response.ok) {
                throw new Error(`Failed to download ${path}: ${response.status}`);
            }
            files.set(path, new Uint8Array(await response.arrayBuffer()));
            console.log(path);
        }
    }

    await mkdir(new URL('.', KROM_BUNDLE), { recursive: true });
    await writeFile(KROM_BUNDLE, packBundle(files));
    console.log(`Wrote ${fileURLToPath(KROM_BUNDLE)}`);
}
