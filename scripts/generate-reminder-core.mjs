import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const target = resolve('supabase/functions/reminder-sender/core.generated.js');
const result = await build({ configFile: false, envFile: false, publicDir: false, logLevel: 'error',
  build: { write: false, minify: false, sourcemap: false, target: 'es2022',
    lib: { entry: resolve('src/reminders/edgeCore.ts'), formats: ['es'], fileName: 'core' } } });
const output = (Array.isArray(result) ? result.flatMap(value => value.output) : result.output).filter(item => item.type === 'chunk');
if (output.length !== 1 || output[0].imports.length || output[0].dynamicImports.length) throw Error('Reminder core must be one self-contained ES module');
const license = readFileSync(resolve('node_modules/rrule/LICENCE'), 'utf8').replaceAll('\r\n', '\n').replaceAll('*/', '* /');
const content = '// Generated from src/reminders/edgeCore.ts by scripts/generate-reminder-core.mjs. Do not edit.\n' +
  '/* Bundled rrule 2.8.1 notices:\n' + license + '\n*/\n' + output[0].code;
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== content) throw Error('Reminder server bundle is stale; run npm run reminders:bundle');
  console.log('Reminder server bundle equals canonical source.');
} else {
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
  console.log(`Generated reminder server core (${Buffer.byteLength(content)} bytes).`);
}
