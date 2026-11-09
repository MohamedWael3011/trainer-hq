import { useEffect, useState } from 'react';
import type { AppStateType } from '@shared/types';

export const useHqState = (): AppStateType | null => {
  const [state, setState] = useState<AppStateType | null>(null);
  useEffect(() => {
    let active = true;
    void window.hq.getState().then((initial) => {
      if (active) setState(initial);
    });
    const unsubscribe = window.hq.onState(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
};
