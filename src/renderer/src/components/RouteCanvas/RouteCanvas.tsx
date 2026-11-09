import { memo, useEffect, useRef } from 'react';
import tilesUrl from '../../assets/tiles.png';
import './styles.css';

const TILE = 16;
const SHEET_COLUMNS = 12;
const GRASS = 0;
const GRASS_TUFT = 1;
const GRASS_FLOWER = 2;
const PATH = 25;
const ROW_TARGET_PX = 46;
const DECORATIONS: [number, number][] = [
  [1, 4], [3, 16], [6, 29], [10, 5], [14, 4], [15, 28], [19, 17], [22, 16], [26, 5], [28, 29], [33, 4], [37, 16],
];

const loadTiles = (): Promise<HTMLImageElement> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = tilesUrl;
  });

const draw = (canvas: HTMLCanvasElement, image: HTMLImageElement): void => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const scale = Math.max(1, Math.round(height / ROW_TARGET_PX)) * ratio;
  const size = TILE * scale;
  const cols = Math.ceil(canvas.width / size);
  const rows = Math.ceil(canvas.height / size);
  const bottom = canvas.height - size;
  let seed = 11;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const tile = (id: number, x: number, y: number) =>
    ctx.drawImage(image, (id % SHEET_COLUMNS) * TILE, Math.floor(id / SHEET_COLUMNS) * TILE, TILE, TILE, x * size, y, size, size);
  for (let row = 1; row <= rows; row += 1) {
    for (let x = 0; x < cols; x += 1) {
      const r = random();
      tile(r < 0.1 ? GRASS_FLOWER : r < 0.38 ? GRASS_TUFT : GRASS, x, bottom - row * size);
    }
  }
  for (let x = 0; x < cols; x += 1) tile(PATH, x, bottom);
  const decorationY = Math.max(0, bottom - 2 * size);
  DECORATIONS.filter(([x]) => x < cols).forEach(([x, id]) => tile(id, x, decorationY));
};

const RouteCanvas = () => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let image: HTMLImageElement | null = null;
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (image) draw(canvas, image);
      });
    };
    void loadTiles().then((loaded) => {
      image = loaded;
      redraw();
    });
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return <canvas ref={ref} className="route-canvas" />;
};

export default memo(RouteCanvas);
