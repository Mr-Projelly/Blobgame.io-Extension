import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = resolve(rootDir, 'dist/blobio-extension.bundle.js');
const loaderFile = resolve(rootDir, 'loader/blobio-loader.user.js');
const virusRuntimeFile = resolve(rootDir, 'src/virus/pageVirusMotherCellBootstrap.js');

await mkdir(dirname(outputFile), { recursive: true });

await build({
  entryPoints: [resolve(rootDir, 'src/main.js')],
  outfile: outputFile,
  bundle: true,
  format: 'iife',
  target: 'es2020',
  loader: {
    '.png': 'dataurl',
  },
  banner: {
    js: '/* Blobio extension bundle. Generated from src/. */',
  },
});

const startMarker = '  /* VIRUS_RUNTIME_START */';
const endMarker = '  /* VIRUS_RUNTIME_END */';
const [loaderSource, runtimeSource] = await Promise.all([
  readFile(loaderFile, 'utf8'),
  readFile(virusRuntimeFile, 'utf8'),
]);

const startIndex = loaderSource.indexOf(startMarker);
const endIndex = loaderSource.indexOf(endMarker);
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error('Virus runtime markers are missing from the loader.');
}

const embeddedRuntime = runtimeSource
  .replace(/^export\s+function\s+pageVirusMotherCellBootstrap/, 'function pageVirusMotherCellBootstrap')
  .trim()
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n');

const nextLoader = `${loaderSource.slice(0, startIndex)}${startMarker}\n${embeddedRuntime}\n${endMarker}${loaderSource.slice(endIndex + endMarker.length)}`;
await writeFile(loaderFile, nextLoader);
