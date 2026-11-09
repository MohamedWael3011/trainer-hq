/// <reference types="vite/client" />
import type { HqApiType } from '@shared/api';

declare global {
  interface Window {
    hq: HqApiType;
  }
}

export {};
