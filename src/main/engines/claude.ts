import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { EventKind } from '@shared/constants';
import { summarizeToolInput } from '../approvals';
import type { RunCallbacksType, RunHandleType, RunOutcomeType } from './types';

const USAGE_LIMIT_PATTERN = /usage limit|rate limit|limit reached|reset at/i;
const STDERR_KEEP = 4000;

const StreamType = {
  SYSTEM: 'system',
  ASSISTANT: 'assistant',
  RESULT: 'result',
  RATE_LIMIT: 'rate_limit_event',
} as const;

const ContentType = {
  TEXT: 'text',
  TOOL_USE: 'tool_use',
} as const;

const SubtypeInit = 'init';

export const runClaude = (options: {
  bin: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  callbacks: RunCallbacksType;
}): RunHandleType => {
  const { bin, args, prompt, cwd, env, timeoutMs, callbacks } = options;
  const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let resultText = '';
  let resultError = false;
  let cancelled = false;
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  if (timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
  }

  child.stdin.end(prompt);
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP);
  });

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    let message: Record<string, any>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === StreamType.SYSTEM && message.subtype === SubtypeInit && message.session_id) {
      callbacks.onSession?.(message.session_id);
      return;
    }
    if (message.type === StreamType.ASSISTANT) {
      const content = (message.message?.content ?? []) as Record<string, any>[];
      content.forEach((part) => {
        if (part.type === ContentType.TEXT && part.text?.trim()) callbacks.onEvent({ kind: EventKind.TEXT, text: part.text });
        if (part.type === ContentType.TOOL_USE) callbacks.onEvent({ kind: EventKind.TOOL, text: summarizeToolInput(part.name, part.input) });
      });
      return;
    }
    if (message.type === StreamType.RATE_LIMIT && message.rate_limit_info) {
      const info = message.rate_limit_info as Record<string, any>;
      const windows = (info.unifiedWindows ?? {}) as Record<string, { utilization?: number }>;
      callbacks.onUsage?.({
        status: String(info.status ?? ''),
        fiveHour: windows.five_hour?.utilization,
        sevenDay: windows.seven_day?.utilization,
        resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    if (message.type === StreamType.RESULT) {
      resultText = typeof message.result === 'string' ? message.result : '';
      resultError = message.is_error === true;
      if (message.session_id) callbacks.onSession?.(message.session_id);
    }
  });

  const done = new Promise<RunOutcomeType>((resolve) => {
    const finish = (code: number | null, spawnError?: Error) => {
      if (timer) clearTimeout(timer);
      const errorText = spawnError?.message ?? (resultError ? resultText : code === 0 ? undefined : stderr.trim() || `claude exited with code ${code}`);
      resolve({
        ok: !spawnError && code === 0 && !resultError && !cancelled && !timedOut,
        resultText,
        error: errorText,
        usageLimited: USAGE_LIMIT_PATTERN.test(`${resultText}\n${stderr}`) && (resultError || code !== 0),
        cancelled,
        timedOut,
      });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });

  return {
    cancel: () => {
      cancelled = true;
      child.kill('SIGTERM');
    },
    done,
  };
};
