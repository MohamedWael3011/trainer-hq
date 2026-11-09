const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const egg = dataUri(join(root, 'resources/sprites/hatchling.png'));
const tiles = dataUri(join(root, 'src/renderer/src/assets/tiles.png'));

const draw = `
(async () => {
  const load = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; });
  const [egg, tiles] = await Promise.all([load(${JSON.stringify(egg)}), load(${JSON.stringify(tiles)})]);
  const size = 1024;
  const inset = 100;
  const box = size - inset * 2;
  const radius = 185;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const squircle = () => {
    ctx.beginPath();
    ctx.moveTo(inset + radius, inset);
    ctx.arcTo(inset + box, inset, inset + box, inset + box, radius);
    ctx.arcTo(inset + box, inset + box, inset, inset + box, radius);
    ctx.arcTo(inset, inset + box, inset, inset, radius);
    ctx.arcTo(inset, inset, inset + box, inset, radius);
    ctx.closePath();
  };

  ctx.save();
  ctx.shadowColor = 'rgba(40, 10, 50, 0.35)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  squircle();
  ctx.fillStyle = '#9b6bff';
  ctx.fill();
  ctx.restore();

  ctx.save();
  squircle();
  ctx.clip();
  const sky = ctx.createLinearGradient(0, inset, 0, inset + box);
  sky.addColorStop(0, '#7a5cf0');
  sky.addColorStop(0.55, '#c98bf0');
  sky.addColorStop(1, '#ffb3d6');
  ctx.fillStyle = sky;
  ctx.fillRect(inset, inset, box, box);

  const sun = ctx.createRadialGradient(size * 0.7, inset + 190, 10, size * 0.7, inset + 190, 260);
  sun.addColorStop(0, 'rgba(255, 220, 240, 0.9)');
  sun.addColorStop(1, 'rgba(255, 220, 240, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(inset, inset, box, box);

  const px = 12;
  const stars = [[230, 230], [330, 170], [780, 300], [250, 380], [700, 200]];
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  stars.forEach(([x, y]) => { ctx.fillRect(x, y, px, px); ctx.fillRect(x - px, y, px, px); ctx.fillRect(x + px, y, px, px); ctx.fillRect(x, y - px, px, px); ctx.fillRect(x, y + px, px, px); });

  const tile = 16;
  const scale = 8;
  const t = tile * scale;
  const groundTop = inset + box - t * 2;
  const tileAt = (id, x, y) => ctx.drawImage(tiles, (id % 12) * tile, Math.floor(id / 12) * tile, tile, tile, x, y, t, t);
  for (let x = inset - t; x < inset + box + t; x += t) {
    tileAt(((x / t) | 0) % 3 === 0 ? 2 : 0, x, groundTop);
    tileAt(25, x, groundTop + t);
  }
  tileAt(4, inset + 40, groundTop - t);
  tileAt(5, inset + box - t - 40, groundTop - t);

  const probe = document.createElement('canvas');
  probe.width = egg.width;
  probe.height = egg.height;
  const pctx = probe.getContext('2d');
  pctx.drawImage(egg, 0, 0);
  const pixels = pctx.getImageData(0, 0, egg.width, egg.height).data;
  let minX = egg.width, minY = egg.height, maxX = 0, maxY = 0;
  for (let y = 0; y < egg.height; y += 1) {
    for (let x = 0; x < egg.width; x += 1) {
      if (pixels[(y * egg.width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const eggScale = Math.floor(440 / Math.max(cropW, cropH));
  const drawW = cropW * eggScale;
  const drawH = cropH * eggScale;
  const feet = groundTop + 70;
  ctx.fillStyle = 'rgba(40, 20, 50, 0.25)';
  ctx.beginPath();
  ctx.ellipse(size / 2, feet, drawW * 0.42, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(egg, minX, minY, cropW, cropH, Math.round((size - drawW) / 2), feet - drawH + 8, drawW, drawH);
  ctx.restore();

  ctx.save();
  squircle();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
})()
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const url = await win.webContents.executeJavaScript(draw);
  const png = Buffer.from(url.split(',')[1], 'base64');
  mkdirSync(join(root, 'build'), { recursive: true });
  writeFileSync(join(root, 'build/icon.png'), png);
  writeFileSync(join(root, 'resources/icon.png'), png);
  process.stdout.write(`icon written (${png.length} bytes)\n`);
  app.quit();
});
