import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'node_modules', 'echarts', 'dist', 'echarts.min.js');
const target = join(root, 'public', 'vendor', 'echarts.min.js');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`synced ${target}`);
