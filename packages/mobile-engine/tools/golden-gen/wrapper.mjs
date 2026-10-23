// Copied to scratch/engine-dist/index.js after the compiled entrypoint is renamed.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import * as real from './index.real.js';
export * from './index.real.js';

const output = process.env.GOLDEN_OUT;
if (!output) throw new Error('GOLDEN_OUT is required for the recorder');
let sequence = existsSync(output) ? readFileSync(output, 'utf8').split('\n').length - 1 : 0;

function encode(value) {
  if (value === undefined) return { $type: 'undefined' };
  if (typeof value === 'bigint') return { $type: 'bigint', value: String(value) };
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { $type: 'number', value: '-0' };
    if (Number.isNaN(value)) return { $type: 'number', value: 'NaN' };
    if (value === Infinity) return { $type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { $type: 'number', value: '-Infinity' };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  }
  return value;
}

function record(operation, args) {
  const sourceName = process.env.GOLDEN_SOURCE;
  if (!sourceName) throw new Error('GOLDEN_SOURCE is required for the recorder');
  const sourceType = sourceName === 'property.test.ts' ? 'property' :
    sourceName === 'supplementary.test.ts' ? 'supplementary' : 'unit';
  const count = operation === 'normalizeRulesConfig' ? args[1] ?? args[0]?.playerCount :
    operation === 'calculateSettlement' || operation === 'isAutomaticMatchEnd' ? args[1]?.seats?.length :
    Array.isArray(args[0]) ? args[0].length : args[0]?.seats?.length ?? args[0]?.points?.length;
  const tags = sourceType === 'supplementary'
    ? (process.env.GOLDEN_TAGS || '').split(',').filter(Boolean)
    : [sourceType, ...(count === 3 || count === 4 ? [`${count}p`] : [])];
  const source = { testFile: sourceName };
  if (sourceType === 'property') source.seed = operation === 'calculateTerminalSettlement' ? '0x71e2a1f0' : '0x53b01e42';
  const fixture = {
    schemaVersion: 1,
    id: `${sourceType}-${++sequence}`,
    operation,
    source,
    args: encode(args),
    expected: undefined,
    tags,
  };
  try {
    const value = real[operation](...args);
    fixture.expected = { kind: 'return', value: encode(value) };
    return value;
  } catch (error) {
    fixture.expected = {
      kind: 'throw',
      errorClass: error?.constructor?.name ?? typeof error,
      message: String(error?.message ?? error),
      category: error instanceof TypeError || error instanceof RangeError ? 'host-type' :
        error instanceof Error && error.stack?.includes('index.real.js') ? 'engine-validation' : 'other',
    };
    throw error;
  } finally {
    appendFileSync(output, `${JSON.stringify(fixture)}\n`);
  }
}

export const normalizeRulesConfig = (...args) => record('normalizeRulesConfig', args);
export const calculateSettlement = (...args) => record('calculateSettlement', args);
export const isAutomaticMatchEnd = (...args) => record('isAutomaticMatchEnd', args);
export const calculateTerminalSettlement = (...args) => record('calculateTerminalSettlement', args);
