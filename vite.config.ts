import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { docsPlugin } from './plugins/docs.ts';
import { romLibraryPlugin } from './plugins/romLibrary.ts';

export default defineConfig({
    // GitHub Pages serves the site from /<repository>/, see .github/workflows/pages.yml
    base: process.env.BASE_PATH ?? '/',
    plugins: [react(), romLibraryPlugin(), docsPlugin()],
    server: {
        port: 3000,
    },
    build: {
        outDir: 'build',
    },
});
