// tsc (see tsconfig.json's "exclude") never copies src/generated/prisma
// into dist/, since it's a pre-generated JS artifact, not TypeScript
// source — but dist/lib/prisma.js still does require('../generated/prisma')
// at runtime. Fine in dev (tsx watch runs straight against src/, where the
// client actually lives) but breaks the production build (`node
// dist/index.js`) unless we copy it over ourselves after tsc runs.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'generated', 'prisma');
const dest = path.join(__dirname, '..', 'dist', 'generated', 'prisma');

if (!fs.existsSync(src)) {
  console.error(`copy-prisma-client: ${src} doesn't exist — run "prisma generate" first.`);
  process.exit(1);
}

fs.cpSync(src, dest, { recursive: true });
console.log(`copy-prisma-client: copied ${src} -> ${dest}`);
