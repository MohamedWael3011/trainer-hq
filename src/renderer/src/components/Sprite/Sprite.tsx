import { memo } from 'react';
import type { AppStateType } from '@shared/types';
import { spriteUrl } from '../../lib/format';

type PropsType = {
  state: AppStateType;
  id: string;
  className?: string;
  alt?: string;
};

const Sprite = ({ state, id, className, alt = '' }: PropsType) => (
  <img className={`px ${className ?? ''}`} src={spriteUrl(state, id)} alt={alt} draggable={false} />
);

export default memo(Sprite);
