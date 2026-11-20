import { build } from 'esbuild';

// Harness supplies React to registered browser plugins through its module loader.
await build({
  entryPoints: ['src/client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.css': 'text' },
  target: 'es2022',
  external: ['react', 'react/jsx-runtime'],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-knowledge",factory(require){const module={exports:{}};',
  },
  footer: { js: 'return module.exports;}});' },
});
