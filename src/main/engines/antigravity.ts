import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { Autonomy, EventKind, type AutonomyType } from '@shared/constants';
import type { RunCallbacksType, RunHandleType, RunOutcomeType } from './types';

const STDERR_KEEP = 4000;
const PARAM_PREVIEW = 160;
const USAGE_LIMIT_PATTERN = /quota|rate limit|resource exhausted|usage limit/i;

// Antigravity's headless mode can't ask for permission, so it silently auto-denies
// anything that needs it. Map the creature's autonomy onto agy's own modes instead.
const AUTONOMY_ARGS: Record<AutonomyType, string[]> = {
  [Autonomy.ASK]: [],
  [Autonomy.AUTO_EDIT]: ['--mode', 'accept-edits'],
  [Autonomy.FULL_AUTO]: ['--dangerously-skip-permissions'],
};

type StepType = {
  step_index?: number;
  state?: string;
  step_type?: string;
  tool_name?: string;
  text_delta?: string;
  tool_info?: { name?: string; parameters?: Record<string, unknown> };
  error?: { message?: string };
};

type LineType = {
  event?: string;
  conversation_id?: string;
  step_update?: StepType;
  result?: { status?: string; response?: string; error?: { message?: string } | string };
};

const summarizeTool = (step: StepType): string => {
  const name = step.tool_info?.name ?? step.tool_name ?? 'tool';
  const params = step.tool_info?.parameters ?? {};
  const first = Object.values(params).find((value) => typeof value === 'string') as string | undefined;
  return first ? `${name} ${first.slice(0, PARAM_PREVIEW)}` : name;
};

const PERMISSION_DENIED = /required the "([^"]+)" permission/;

const friendly = (message: string): string => {
  const denied = PERMISSION_DENIED.exec(message);
  return denied
    ? `Antigravity needed permission for ${denied[1]} and can't ask in the background, so it stopped. Switch this creature to Auto-edit or Full auto to let it act.`
    : message;
};

export const planAntigravityArgs = (options: {
  autonomy: AutonomyType;
  model?: string;
  addDirs: string[];
  conversationId?: string;
}): string[] => [
  '--output-format', 'stream-json',
  ...AUTONOMY_ARGS[options.autonomy],
  ...options.addDirs.flatMap((dir) => ['--add-dir', dir]),
  ...(options.model ? ['--model', options.model] : []),
  ...(options.conversationId ? ['--conversation', options.conversationId] : []),
];

export const runAntigravity = (options: {
  bin: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  callbacks: RunCallbacksType;
}): RunHandleType => {
  const { bin, args, prompt, cwd, env, timeoutMs, callbacks } = options;
  const child = spawn(bin, ['-p', prompt, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let resultText = '';
  let resultError: string | undefined;
  let cancelled = false;
  let timedOut = false;
  let sessionSent = false;
  const texts = new Map<number, string>();
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs) : undefined;

  const flushText = (index: number): void => {
    const text = texts.get(index)?.trim();
    texts.delete(index);
    if (text) callbacks.onEvent({ kind: EventKind.TEXT, text });
  };

  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let data: LineType;
    try {
      data = JSON.parse(line) as LineType;
    } catch {
      if (line.trim()) callbacks.onEvent({ kind: EventKind.TEXT, text: line });
      return;
    }
    const conversationId = data.conversation_id ?? (data.step_update as { conversation_id?: string } | undefined)?.conversation_id;
    if (conversationId && !sessionSent) {
      sessionSent = true;
      callbacks.onSession?.(conversationId);
    }
    if (data.event === 'step_update' && data.step_update) {
      const step = data.step_update;
      const index = step.step_index ?? -1;
      if (step.step_type === 'agent_response') {
        if (step.text_delta) texts.set(index, (texts.get(index) ?? '') + step.text_delta);
        if (step.state === 'DONE') flushText(index);
        return;
      }
      if (step.step_type === 'tool') {
        if (step.state === 'ACTIVE') callbacks.onEvent({ kind: EventKind.TOOL, text: summarizeTool(step) });
        if (step.state === 'ERROR') callbacks.onEvent({ kind: EventKind.ERROR, text: step.error?.message?.split('\n')[0] ?? `${summarizeTool(step)} failed` });
      }
      return;
    }
    if (data.event === 'result' && data.result) {
      [...texts.keys()].forEach(flushText);
      resultText = data.result.response?.trim() ?? '';
      if (data.result.status && data.result.status !== 'SUCCESS') {
        const error = data.result.error;
        resultError = (typeof error === 'string' ? error : error?.message) ?? `Antigravity finished with status ${data.result.status}`;
      }
    }
  });

  const done = new Promise<RunOutcomeType>((resolve) => {
    const finish = (code: number | null, spawnError?: Error) => {
      if (timer) clearTimeout(timer);
      [...texts.keys()].forEach(flushText);
      const quietFailure = code === 0 && !resultText && stderr.trim() ? friendly(stderr.trim()) : undefined;
      const error = spawnError?.message ?? resultError ?? quietFailure ?? (code === 0 ? undefined : stderr.trim() || `${bin} exited with code ${code}`);
      resolve({
        ok: !error && !cancelled && !timedOut,
        resultText,
        error,
        usageLimited: !!error && USAGE_LIMIT_PATTERN.test(error),
        cancelled,
        timedOut,
      });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });

  return { cancel: () => { cancelled = true; child.kill('SIGTERM'); }, done };
};
