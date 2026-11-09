import type { ReactNode } from 'react';

export const renderIf = (condition: boolean, node: ReactNode): ReactNode => (condition ? node : null);
