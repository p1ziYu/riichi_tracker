import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tools = dirname(fileURLToPath(import.meta.url));
const root = resolve(tools, '../../../..');
const scratch = join(homedir(), 'golden-scratch');
const scratchDist = join(scratch, 'engine-dist');
const scratchOutput = join(scratch, 'output');
const golden = join(root, 'packages/mobile-engine/golden');
const pinnedSource = 'e17744271610b2a82b0825c8ca4bfa7aa4604ccbdb5577cefc032a2d9b003df4';
const generatorVersion = '1.0.0';
const operations = ['normalizeRulesConfig', 'calculateSettlement', 'isAutomaticMatchEnd', 'calculateTerminalSettlement'];
const files = ['fixtures-unit.jsonl', 'fixtures-property.jsonl', 'fixtures-supplementary.jsonl'];
const hash = (data) => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceHash = hash(readFileSync(join(root, 'packages/engine/src/index.ts')));
if (sourceHash !== pinnedSource) throw new Error(`Engine oracle changed: ${sourceHash}; expected ${pinnedSource}. STOP.`);
if (git('status', '--porcelain', '--untracked-files=no', '--', 'packages/', 'apps/')) {
  throw new Error('Tracked packages/ or apps/ files dirty before build; refusing to proceed.');
}
execFileSync('pnpm', ['--filter', '@riichi/engine', 'build'], { cwd: root, stdio: 'inherit' });
if (git('status', '--porcelain', '--untracked-files=no', '--', 'packages/', 'apps/')) {
  throw new Error('Tracked packages/ or apps/ files dirty after engine build; STOP.');
}
mkdirSync(scratch, { recursive: true });
rmSync(scratchDist, { recursive: true, force: true });
rmSync(scratchOutput, { recursive: true, force: true });
mkdirSync(scratchOutput, { recursive: true });
cpSync(join(root, 'packages/engine/dist'), scratchDist, { recursive: true });
renameSync(join(scratchDist, 'index.js'), join(scratchDist, 'index.real.js'));
copyFileSync(join(tools, 'wrapper.mjs'), join(scratchDist, 'index.js'));
writeFileSync(join(scratchOutput, 'package.json'), '{"type":"module"}\n');
const summaries = [];
for (const test of ['engine.test', 'engine-audit-regressions.test', 'engine-boundary.test', 'property.test']) {
  const isProperty = test === 'property.test';
  const out = join(scratchOutput, files[isProperty ? 1 : 0]);
  const source = `${test}.ts`;
  try {
    const tap = execFileSync('node', ['--test', join(scratchDist, 'test', `${test}.js`)], {
      cwd: scratch,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GOLDEN_OUT: out, GOLDEN_SOURCE: source },
    });
    const tests = Number(tap.match(/^# tests (\d+)$/m)?.[1]);
    const pass = Number(tap.match(/^# pass (\d+)$/m)?.[1]);
    const fail = Number(tap.match(/^# fail (\d+)$/m)?.[1]);
    if (!Number.isInteger(tests) || tests !== pass || fail !== 0) throw new Error(`Invalid test summary for ${source}: ${tap}`);
    console.log(`${source}: ${pass}/${tests} pass; fail ${fail}`);
    summaries.push({ testFile: source, tests, pass, fail });
  } catch (error) {
    if (error.stdout) console.error(String(error.stdout));
    if (error.stderr) console.error(String(error.stderr));
    throw error;
  }
}
const supplementOut = join(scratchOutput, files[2]);
process.env.GOLDEN_OUT = supplementOut;
process.env.GOLDEN_SOURCE = 'supplementary.test.ts';
const engine = await import(pathToFileURL(join(scratchDist, 'index.js')).href);
const { generate } = await import('./supplementary.mjs');
await generate(engine);
delete process.env.GOLDEN_TAGS;
const entry = {};
let totalCount = 0;
for (const filename of files) {
  const content = existsSync(join(scratchOutput, filename)) ? readFileSync(join(scratchOutput, filename)) : Buffer.alloc(0);
  const counts = Object.fromEntries(operations.map((name) => [name, 0]));
  for (const line of content.toString('utf8').trim().split('\n')) {
    if (!line) continue;
    const fixture = JSON.parse(line);
    if (!(fixture.operation in counts)) throw new Error(`Unexpected operation: ${fixture.operation}`);
    counts[fixture.operation]++;
  }
  const fileCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
  totalCount += fileCount;
  entry[filename] = { counts, totalCount: fileCount, sha256: hash(content) };
  console.log(`${filename}: ${fileCount} fixtures, ${content.byteLength} bytes, sha256 ${entry[filename].sha256}`);
}
const oracle = await import(pathToFileURL(join(scratchDist, 'index.real.js')).href);
const manifest = {
  schemaVersion: 1,
  engineVersion: oracle.ENGINE_VERSION,
  engineSourceSha256: sourceHash,
  gitCommit: git('rev-parse', 'HEAD'),
  generatorVersion,
  files: entry,
  totalCount,
};
// Publish only after all tests and supplementary invocations complete successfully.
mkdirSync(golden, { recursive: true });
for (const filename of files) copyFileSync(join(scratchOutput, filename), join(golden, filename));
writeFileSync(join(golden, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(scratchOutput, 'test-summaries.json'), `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`TOTAL ${totalCount}; tests ${summaries.reduce((n, row) => n + row.tests, 0)}/${summaries.reduce((n, row) => n + row.tests, 0)}`);
