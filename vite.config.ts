import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), {
    name: 'offline-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('Missing HTML entry');
      let source = String(html.source);
      for (const [file, asset] of Object.entries(bundle)) {
        if (asset.type === 'chunk') {
          source = source.replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/,
            () => `<script type="module">${asset.code.replace(/<\/script/gi, '<\\/script')}</script>`);
          delete bundle[file];
        } else if (file.endsWith('.css')) {
          source = source.replace(/<link\b[^>]*href="[^"]+\.css"[^>]*>/,
            () => `<style>${asset.source}</style>`);
          delete bundle[file];
        }
      }
      html.source = source;
    }
  }],
  build: { outDir: 'public', emptyOutDir: false, target: 'chrome100', cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } }
});
