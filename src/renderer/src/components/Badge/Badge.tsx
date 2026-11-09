import { memo, type ReactNode } from 'react';
import { BadgeTone, type BadgeToneType } from '../../lib/format';
import './styles.css';

type PropsType = {
  tone?: BadgeToneType;
  dot?: boolean;
  children: ReactNode;
};

const Badge = ({ tone = BadgeTone.NEUTRAL, dot = false, children }: PropsType) => (
  <span className={`badge badge-${tone}${dot ? ' badge-dot' : ''}`}>{children}</span>
);

export default memo(Badge);
