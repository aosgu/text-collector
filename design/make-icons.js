const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const srcDir = path.join(__dirname, 'icon-src');
const outDir = path.join(__dirname, '..', 'text-collector', 'icons');

const targets = [
  { src: 'icon.svg',  out: 'icon128.png', size: 128 },
  { src: 'icon48.svg', out: 'icon48.png',  size: 48  },
  { src: 'icon16.svg', out: 'icon16.png',  size: 16  },
];

(async () => {
  for (const t of targets) {
    const svg = fs.readFileSync(path.join(srcDir, t.src));
    await sharp(svg, { density: 384 })
      .resize(t.size, t.size)
      .png()
      .toFile(path.join(outDir, t.out));
    console.log('wrote', t.out);
  }
})();
