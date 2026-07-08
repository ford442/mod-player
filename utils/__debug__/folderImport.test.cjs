const { spawnSync } = require('child_process');
const fs = require('fs');

console.log('Running folderImport tests...');

const testScript = `
import { isModuleFileName, formatFromFileName, inferWebkitRootLabel } from '../folderImport.ts';

if (!isModuleFileName('track.XM')) throw new Error('XM extension');
if (!isModuleFileName('deep/nested/module.it')) throw new Error('IT nested path');
if (isModuleFileName('readme.txt')) throw new Error('txt should be rejected');
if (formatFromFileName('foo.bar.mod') !== 'mod') throw new Error('format parse');

const label = inferWebkitRootLabel([{
  relativePath: 'MyMods/sub/chip.mod',
  fileName: 'chip.mod',
  size: 1,
  lastModified: 0,
  getArrayBuffer: async () => new ArrayBuffer(0),
}]);
if (label !== 'MyMods') throw new Error('webkit root label: ' + label);

console.log('All folderImport tests passed.');
`;

const temp = 'utils/__debug__/temp.folderImport.test.ts';
fs.writeFileSync(temp, testScript);
const result = spawnSync('npx', ['tsx', temp], { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
fs.unlinkSync(temp);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error('folderImport tests FAILED');
  process.exit(result.status ?? 1);
}
console.log('folderImport tests OK');
