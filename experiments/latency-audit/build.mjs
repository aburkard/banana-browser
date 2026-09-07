import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';

const target = 'public/tmp/latency-audit';
if (process.argv.includes('--clean')) {
  await rm(target, { recursive: true, force: true });
} else {
  await mkdir(target, { recursive: true });
  await build({ entryPoints: ['src/subscription.ts'], bundle: true, format: 'esm', outfile: `${target}/subscription.js`, define: { 'import.meta.env.BASE_URL': '"/banana-browser/"' } });
  await copyFile('experiments/latency-audit/index.html', `${target}/index.html`);
  console.log('/banana-browser/tmp/latency-audit/index.html — open on the existing authenticated app origin');
}
