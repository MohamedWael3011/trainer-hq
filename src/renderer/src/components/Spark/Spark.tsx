import { memo } from 'react';
import './styles.css';

type PropsType = {
  values: number[];
};

const WIDTH = 280;
const HEIGHT = 64;
const GAP = 4;

const Spark = ({ values }: PropsType) => {
  const max = Math.max(1, ...values);
  const barWidth = (WIDTH - GAP * (values.length - 1)) / values.length;
  return (
    <svg className="spark" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Quests per day, last 14 days">
      {values.map((value, index) => {
        const height = Math.max(2, (value / max) * HEIGHT);
        return (
          <rect
            key={index}
            className={index === values.length - 1 ? 'spark-bar spark-today' : 'spark-bar'}
            x={index * (barWidth + GAP)}
            y={HEIGHT - height}
            width={barWidth}
            height={height}
            rx={2}
          >
            <title>{`${value} quests`}</title>
          </rect>
        );
      })}
    </svg>
  );
};

export default memo(Spark);
