import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { EventKind } from '@shared/constants';
import type { RunCallbacksType, RunHandleType, RunOutcomeType } from './types';

const PROMPT_TOKEN = '{prompt}';
const SYSTEM_TOKEN = '{system}';
const STDERR_KEEP = 4000;

export const runCli = (options: {
  bin: string;
  args: string[];
  prompt: string;
  systemPrompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  callbacks: RunCallbacksType;
}): RunHandleType => {
  const { bin, args, prompt, systemPrompt, cwd, env, timeoutMs, callbacks } = options;
  const usesPromptArg = args.some((arg) => arg.includes(PROMPT_TOKEN));
  const usesSystemArg = args.some((arg) => arg.includes(SYSTEM_TOKEN));
  const fullPrompt = usesSystemArg ? prompt : `${systemPrompt}\n\n---\n\n${prompt}`;
  const finalArgs = args.map((arg) => arg.replace(PROMPT_TOKEN, fullPrompt).replace(SYSTEM_TOKEN, systemPrompt));
  const child = spawn(bin, finalArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let stderr = '';
  let cancelled = false;
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : undefined;

  if (usesPromptArg) child.stdin.end();
  else child.stdin.end(fullPrompt);

  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`;
    if (line.trim()) callbacks.onEvent({ kind: EventKind.TEXT, text: line });
  });

  const done = new Promise<RunOutcomeType>((resolve) => {
    const finish = (code: number | null, spawnError?: Error) => {
      if (timer) clearTimeout(timer);
      // Some CLIs exit 0 with no output and explain why on stderr (e.g. a denied permission).
      const quietFailure = code === 0 && !output.trim() && stderr.trim() ? stderr.trim() : undefined;
      const error = spawnError?.message ?? quietFailure ?? (code === 0 ? undefined : stderr.trim() || `${bin} exited with code ${code}`);
      resolve({
        ok: !error && !cancelled && !timedOut,
        resultText: output.trim(),
        error,
        usageLimited: false,
        cancelled,
        timedOut,
      });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });

  return { cancel: () => { cancelled = true; child.kill('SIGTERM'); }, done };
};
