import { useState } from 'react';
import { OUTPUT_PROTOCOL } from '@shared/constants';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const SHOWN = 12;

const fileUrl = (path: string): string => `${OUTPUT_PROTOCOL}://f${path.split('/').map(encodeURIComponent).join('/')}`;
const fileName = (path: string): string => path.split('/').pop() ?? path;
const parentDir = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

// The folder every file sits in, so the card can say where things were saved.
const commonDir = (paths: string[]): string => {
  const parts = paths.map((path) => parentDir(path).split('/'));
  const shared: string[] = [];
  for (let index = 0; index < parts[0].length; index += 1) {
    if (parts.every((entry) => entry[index] === parts[0][index])) shared.push(parts[0][index]);
    else break;
  }
  return shared.join('/') || '/';
};

const relativeTo = (dir: string, path: string): string => (path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path);

// Renders, pages and documents a creature produced during a reply, with where they were saved.
const OutputFiles = ({ paths }: { paths: string[] }) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  if (paths.length === 0) return null;
  const dir = commonDir(paths);
  const images = paths.filter((path) => IMAGE.test(path));
  const others = paths.filter((path) => !IMAGE.test(path));
  const visible = showAll ? images : images.slice(0, SHOWN);
  return (
    <div className="of">
      <div className="of-head">
        <span className="of-title">Files from this reply · {paths.length}</span>
        <button className="btn sm ghost" onClick={() => void window.hq.openPath(dir)}>Open folder</button>
      </div>
      <span className="of-dir selectable" title={dir}><bdi>Saved in {dir}</bdi></span>
      {renderIf(visible.length > 0, (
        <div className="of-grid">
          {visible.map((path) => (
            <button key={path} className="of-thumb" title={relativeTo(dir, path)} onClick={() => setPreview(path)}>
              <img src={fileUrl(path)} alt={fileName(path)} loading="lazy" />
              <span>{relativeTo(dir, path)}</span>
            </button>
          ))}
        </div>
      ))}
      {renderIf(images.length > SHOWN && !showAll, <button className="btn sm ghost of-more" onClick={() => setShowAll(true)}>Show all {images.length} images</button>)}
      {renderIf(others.length > 0, (
        <div className="of-files">
          {others.map((path) => (
            <button key={path} className="of-file" title={`Open ${path}`} onClick={() => void window.hq.openPath(path)}>
              {relativeTo(dir, path)}
            </button>
          ))}
        </div>
      ))}
      {renderIf(!!preview, preview ? (
        <div className="of-preview" role="dialog" aria-label={fileName(preview)} onClick={() => setPreview(undefined)}>
          <img src={fileUrl(preview)} alt={fileName(preview)} />
          <div className="of-preview-bar" onClick={(event) => event.stopPropagation()}>
            <span className="selectable">{preview}</span>
            <button className="btn sm" onClick={() => void window.hq.openPath(preview)}>Open</button>
            <button className="btn sm ghost" onClick={() => setPreview(undefined)}>Close</button>
          </div>
        </div>
      ) : null)}
    </div>
  );
};

export default OutputFiles;
