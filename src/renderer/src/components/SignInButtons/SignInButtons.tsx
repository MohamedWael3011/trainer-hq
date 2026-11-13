import { memo } from 'react';
import { SIGN_IN_COMMAND, SIGN_IN_LABEL, signInsNeeded } from '@shared/signIn';
import { renderIf } from '../../lib/renderIf';
import './styles.css';

type PropsType = {
  text: string;
};

const SignInButtons = ({ text }: PropsType) => {
  const kinds = signInsNeeded(text);
  return <>{renderIf(kinds.length > 0, (
    <div className="sign-in-buttons">
      {kinds.map((kind) => (
        <button key={kind} className="btn sm primary" title={`Opens Terminal and runs: ${SIGN_IN_COMMAND[kind]}`} onClick={() => void window.hq.signIn(kind)}>
          {SIGN_IN_LABEL[kind]}
        </button>
      ))}
    </div>
  ))}</>;
};

export default memo(SignInButtons);
