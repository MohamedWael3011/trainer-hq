import { useCallback, useState, type FormEvent } from 'react';
import { SCHEDULE_CADENCES, ScheduleCadence, type ScheduleCadenceType } from '@shared/constants';
import type { AppStateType, ScheduleType } from '@shared/types';
import Sprite from '../Sprite/Sprite';
import { renderIf } from '../../lib/renderIf';
import { creatureName } from '../../lib/format';
import './styles.css';

type PropsType = {
  state: AppStateType;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_TIME = '09:00';
const DEFAULT_WEEKDAY = 1;

const pad = (value: number): string => String(value).padStart(2, '0');

const describe = (schedule: ScheduleType): string => {
  const cadence = SCHEDULE_CADENCES.find((entry) => entry.id === schedule.cadence)?.label ?? schedule.cadence;
  if (schedule.cadence === ScheduleCadence.HOURLY) return `${cadence} at :${pad(schedule.minute)}`;
  const day = schedule.cadence === ScheduleCadence.WEEKLY ? ` on ${WEEKDAYS[schedule.weekday]}` : '';
  return `${cadence}${day} at ${pad(schedule.hour)}:${pad(schedule.minute)}`;
};

const when = (at: number): string => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const Schedules = ({ state }: PropsType) => {
  const [adding, setAdding] = useState(false);
  const [creatureId, setCreatureId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cadence, setCadence] = useState<ScheduleCadenceType>(ScheduleCadence.DAILY);
  const [time, setTime] = useState(DEFAULT_TIME);
  const [weekday, setWeekday] = useState(DEFAULT_WEEKDAY);
  const [error, setError] = useState<string | null>(null);
  const chosen = creatureId || state.creatures[0]?.id || '';

  const save = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const [hour, minute] = time.split(':').map(Number);
    setError(null);
    try {
      await window.hq.saveSchedule({ creatureId: chosen, prompt, cadence, hour: hour || 0, minute: minute || 0, weekday, enabled: true });
      setPrompt('');
      setAdding(false);
    } catch (failure) {
      setError((failure as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }, [chosen, prompt, cadence, time, weekday]);

  const toggle = useCallback((schedule: ScheduleType) => {
    void window.hq.saveSchedule({ ...schedule, enabled: !schedule.enabled });
  }, []);

  return (
    <div className="panel sched">
      <div className="sched-head">
        <div className="eyebrow">Recurring quests</div>
        <button className="btn sm ghost" onClick={() => setAdding((open) => !open)} disabled={state.creatures.length === 0}>{adding ? 'Close' : '+ Recurring quest'}</button>
      </div>
      {renderIf(state.schedules.length === 0 && !adding, <p className="faint sched-empty">Ask a creature the same thing on a schedule, such as a daily metrics check that refreshes one artifact.</p>)}
      {state.schedules.map((schedule) => (
        <div key={schedule.id} className={`sched-row${schedule.enabled ? '' : ' sched-off'}`}>
          <Sprite state={state} id={schedule.creatureId} className="sched-sprite" />
          <div className="sched-main">
            <span className="sched-prompt">{schedule.prompt}</span>
            <span className="sched-meta">
              {creatureName(state, schedule.creatureId)} · {describe(schedule)} · {schedule.enabled ? `next ${when(schedule.nextRunAt)}` : 'paused'}
              {schedule.lastRunAt ? ` · last ${when(schedule.lastRunAt)}` : ''}
            </span>
          </div>
          <div className="sched-side">
            <button className="btn sm ghost" onClick={() => void window.hq.runSchedule(schedule.id)}>Run now</button>
            <button className="btn sm ghost" onClick={() => toggle(schedule)}>{schedule.enabled ? 'Pause' : 'Resume'}</button>
            <button className="btn sm ghost danger" onClick={() => void window.hq.deleteSchedule(schedule.id)}>Delete</button>
          </div>
        </div>
      ))}
      {renderIf(adding, (
        <form className="sched-form" onSubmit={(event) => void save(event)}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} placeholder="How is the predictive slot feature doing? Update the same artifact with this week's numbers." autoFocus />
          <div className="sched-fields">
            <select aria-label="Creature" value={chosen} onChange={(event) => setCreatureId(event.target.value)}>
              {state.creatures.map((creature) => <option key={creature.id} value={creature.id}>{creature.name}</option>)}
            </select>
            <select aria-label="How often" value={cadence} onChange={(event) => setCadence(event.target.value as ScheduleCadenceType)}>
              {SCHEDULE_CADENCES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            {renderIf(cadence === ScheduleCadence.WEEKLY, (
              <select aria-label="Day" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
                {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            ))}
            <input aria-label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            <button className="btn sm primary" type="submit" disabled={!prompt.trim() || !chosen}>Save</button>
          </div>
          <p className="faint sched-note">Runs while Trainer HQ is open. One missed while it was closed runs once at the next launch.{cadence === ScheduleCadence.HOURLY ? ' Hourly uses only the minutes of the time.' : ''}</p>
          {renderIf(!!error, <p className="sched-error selectable">{error}</p>)}
        </form>
      ))}
    </div>
  );
};

export default Schedules;
