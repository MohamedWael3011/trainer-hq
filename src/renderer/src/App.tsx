import { Surface, type SurfaceType } from '@shared/constants';
import { useHqState } from './hooks/useHqState';
import Dock from './surfaces/Dock/Dock';
import Notch from './surfaces/Notch/Notch';
import Dashboard from './surfaces/Dashboard/Dashboard';
import { renderIf } from './lib/renderIf';

type PropsType = {
  surface: SurfaceType;
};

const App = ({ surface }: PropsType) => {
  const state = useHqState();
  if (!state) return null;
  return (
    <>
      {renderIf(surface === Surface.DOCK, <Dock state={state} />)}
      {renderIf(surface === Surface.NOTCH, <Notch state={state} />)}
      {renderIf(surface === Surface.DASHBOARD, <Dashboard state={state} />)}
    </>
  );
};

export default App;
