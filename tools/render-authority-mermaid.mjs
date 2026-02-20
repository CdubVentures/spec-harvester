import { execSync } from 'node:child_process';
import path from 'node:path';

const baseDir = path.join('implementation', 'SpecFactory Ecosystem Data Managament', 'diagrams', 'authority-flows');

const diagrams = [
  'component-authoritative-flow',
  'enum-master-flow',
  'lane-decoupling-flow',
  'entity-hierarchy',
];

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

for (const name of diagrams) {
  const input = path.join(baseDir, `${name}.mmd`);
  const outPng = path.join(baseDir, `${name}.4k.png`);
  const outSvg = path.join(baseDir, `${name}.svg`);

  run(`npx mmdc -i "${input}" -o "${outPng}" -w 3840 -H 2160 -b white`);
  run(`npx mmdc -i "${input}" -o "${outSvg}"`);
}

console.log('Rendered authority Mermaid diagrams (4K PNG + SVG).');
