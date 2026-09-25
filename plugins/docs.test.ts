import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { docHref, findDocs, renderDoc, renderDocs } from './docs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'https://github.com/owner/repo';
const DOCS = new Set(['docs/plan.md', 'docs/guide.md']);

const render = (markdown: string, path = 'docs/guide.md') => renderDoc(markdown, path, DOCS, REPO).html;

describe('docs rendering', () => {
    test('takes the title from the first heading', () => {
        expect(renderDoc('Intro\n\n# The `plan`\n\n## Later', 'docs/plan.md', DOCS, REPO).title).toBe('The plan');
        expect(renderDoc('No heading', 'docs/plan.md', DOCS, REPO).title).toBe('docs/plan.md');
    });

    test('gives headings ids like GitHub', () => {
        expect(render('## 1. Cartridge (small)')).toContain('<h2 id="1-cartridge-small">');
    });

    test('keeps links to other docs in the app, relative to the doc', () => {
        expect(render('[plan](plan.md)')).toContain(`href="${docHref('docs/plan.md')}"`);
        expect(render('[plan](./plan.md#later)')).toContain(`href="${docHref('docs/plan.md', 'later')}"`);
        expect(render('[plan](../docs/plan.md)')).toContain(`href="${docHref('docs/plan.md')}"`);
    });

    test('keeps links to headings in the same doc in the app', () => {
        expect(render('[up](#top)', 'docs/plan.md')).toContain(`href="${docHref('docs/plan.md', 'top')}"`);
    });

    test('links other files in the repository to GitHub, in a new tab', () => {
        const readme = render('[readme](../README.md#testing)');
        expect(readme).toContain(`href="${REPO}/blob/main/README.md#testing"`);
        expect(readme).toContain('target="_blank"');
        expect(render('[types](../src/systems/types.ts)')).toContain(`href="${REPO}/blob/main/src/systems/types.ts"`);
    });

    test('opens external links in a new tab', () => {
        const html = render('[wiki](https://www.nesdev.org/wiki/)');
        expect(html).toContain('href="https://www.nesdev.org/wiki/"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noreferrer"');
    });

    test('loads images in the repository from GitHub', () => {
        expect(render('![diagram](images/bus.png)')).toContain(`src="${REPO}/raw/main/docs/images/bus.png"`);
    });
});

describe('the project docs', () => {
    const docs = renderDocs(ROOT);

    test('are the markdown files in the docs folder', () => {
        const paths = findDocs(ROOT);
        expect(paths).toContain('docs/nes-plan.md');
        expect(paths).toContain('docs/snes-plan.md');
        expect(paths.every(path => /^docs\/[^/]+\.md$/.test(path))).toBe(true);
        expect(docs.map(doc => doc.path)).toEqual(paths);
    });

    // A renamed heading or moved doc would otherwise leave a dead link in the app
    test('only link to docs and headings that exist', () => {
        const ids = new Map(docs.map(doc => [doc.path, new Set([...doc.html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))]));
        const broken: string[] = [];
        for (const doc of docs) {
            for (const [, target] of doc.html.matchAll(/href="#\/docs\/([^"]+)"/g)) {
                const [path = '', anchor] = target!.split('#');
                if (!ids.has(path) || (anchor && !ids.get(path)!.has(anchor))) broken.push(`${doc.path} -> ${target}`);
            }
        }
        expect(broken).toEqual([]);
    });
});
