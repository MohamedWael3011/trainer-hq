import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Surface, type SurfaceType } from '@shared/constants';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';

const SURFACES = Object.values(Surface) as string[];
const hash = window.location.hash.replace('#', '');
const surface: SurfaceType = SURFACES.includes(hash) ? (hash as SurfaceType) : Surface.DASHBOARD;
document.documentElement.dataset.surface = surface;
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App surface={surface} />
  </StrictMode>,
);
