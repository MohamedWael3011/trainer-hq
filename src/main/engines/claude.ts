import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { EventKind } from '@shared/constants';
import type { QuestLiveType, QuestUsageType } from '@shared/types';
import { summarizeToolInput } from '../approvals';
import type { RunCallbacksType, RunHandleType, RunOutcomeType } from './types';
import { claudeFlagSupport } from './claudeFlags';

const USAGE_LIMIT_PATTERN = /usage limit|rate limit|limit reached|reset at/i;
const STDERR_KEEP = 4000;

const StreamType = {
  SYSTEM: 'system',
  ASSISTANT: 'assistant',
  RESULT: 'result',
  RATE_LIMIT: 'rate_limit_event',
  STREAM: 'stream_event',
  USER: 'user',
} as const;

const CHARS_PER_TOKEN = 4;
const DONE_TASK = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled']);

const ContentType = {
  TEXT: 'text',
  TOOL_USE: 'tool_use',
} as const;

const SubtypeInit = 'init';
const SubtypeCompact = 'compact_boundary';

const formatK = (tokens: number): string => (tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens));

// One stream-json user message. The process keeps reading these, so a message sent while Claude is
// working is picked up mid-task the way the terminal does it, instead of starting a second run.
const userLine = (text: string): string => `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

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
  const supports = claudeFlagSupport(bin, env);
  // A live input stream lets follow-ups join the running task. Very old CLIs only take a plain prompt.
  const streamInput = supports('--input-format');
  const extra = [
    ...(streamInput ? ['--input-format', 'stream-json'] : []),
    ...(supports('--include-partial-messages') ? ['--include-partial-messages'] : []),
    ...(supports('--forward-subagent-text') ? ['--forward-subagent-text'] : []),
  ];
  const child = spawn(bin, [...args, ...extra], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  // Live status, like the terminal's spinner line: output tokens so far, the reply being typed, helpers running.
  const live: QuestLiveType = { phase: 'starting', outputTokens: 0, draft: '', agents: [] };
  const agents = new Map<string, string>();
  let doneTokens = 0;
  let messageChars = 0;
  let thinkingTokens = 0;
  const pushLive = (patch: Partial<QuestLiveType>): void => {
    Object.assign(live, patch);
    live.outputTokens = doneTokens + thinkingTokens + Math.round(messageChars / CHARS_PER_TOKEN);
    live.agents = Array.from(agents.values());
    callbacks.onLive?.({ ...live });
  };
  let stderr = '';
  let resultText = '';
  let resultError = false;
  let cancelled = false;
  let timedOut = false;
  let questUsage: QuestUsageType | undefined;
  let contextTokens = 0;
  let inputOpen = true;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, hasCost: false };
  const closeInput = (): void => {
    if (!inputOpen) return;
    inputOpen = false;
    child.stdin.end();
  };
  let timer: NodeJS.Timeout | undefined;

  if (timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
  }

  child.stdin.on('error', () => {
    inputOpen = false;
  });
  if (streamInput) child.stdin.write(userLine(prompt));
  else {
    inputOpen = false;
    child.stdin.end(prompt);
  }
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
    const fromHelper = !!message.parent_tool_use_id;
    if (message.type === StreamType.STREAM && !fromHelper) {
      const event = (message.event ?? {}) as Record<string, any>;
      if (event.type === 'message_start') {
        messageChars = 0;
        thinkingTokens = 0;
      } else if (event.type === 'content_block_start') {
        const block = (event.content_block ?? {}) as Record<string, any>;
        if (block.type === 'tool_use') pushLive({ phase: 'tool', tool: String(block.name ?? '') });
        else if (block.type === 'thinking') pushLive({ phase: 'thinking', tool: undefined });
        else if (block.type === 'text') pushLive({ phase: 'writing', tool: undefined });
      } else if (event.type === 'content_block_delta') {
        const delta = (event.delta ?? {}) as Record<string, any>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          messageChars += delta.text.length;
          pushLive({ draft: live.draft + delta.text });
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          messageChars += delta.partial_json.length;
          pushLive({});
        }
      } else if (event.type === 'message_delta' && event.usage?.output_tokens !== undefined) {
        // The real count replaces the estimate once the message is done.
        doneTokens += Number(event.usage.output_tokens);
        messageChars = 0;
        thinkingTokens = 0;
        pushLive({});
      }
      return;
    }
    if (message.type === StreamType.SYSTEM) {
      if (message.subtype === 'thinking_tokens' && !fromHelper) {
        thinkingTokens = Number(message.estimated_tokens ?? thinkingTokens);
        pushLive({ phase: 'thinking' });
      } else if (message.subtype === 'status') {
        if (message.status === 'compacting') pushLive({ phase: 'compacting', tool: undefined });
        else if (message.status === 'requesting' && live.phase !== 'writing') pushLive({ phase: 'thinking', tool: undefined });
      } else if (message.subtype === 'task_started' && message.task_id) {
        agents.set(String(message.task_id), String(message.description ?? message.subagent_type ?? 'helper'));
        pushLive({});
      } else if ((message.subtype === 'task_updated' && DONE_TASK.has(String(message.patch?.status))) || message.subtype === 'task_notification') {
        agents.delete(String(message.task_id));
        pushLive({});
      }
    }
    if (message.type === StreamType.USER && !fromHelper) {
      // A tool result came back; Claude is about to think about it.
      pushLive({ phase: 'thinking', tool: undefined });
    }
    if (message.type === StreamType.SYSTEM && message.subtype === SubtypeCompact) {
      const meta = (message.compact_metadata ?? {}) as Record<string, unknown>;
      const before = Number(meta.pre_tokens ?? 0);
      const after = Number(meta.post_tokens ?? 0);
      const how = meta.trigger === 'manual' ? 'Compacted' : 'Auto-compacted';
      callbacks.onEvent({ kind: EventKind.SYSTEM, text: before > 0 && after > 0 ? `${how} the conversation: ${formatK(before)} → ${formatK(after)} tokens.` : `${how} the conversation.` });
      if (after > 0) contextTokens = after;
      return;
    }
    if (message.type === StreamType.ASSISTANT && fromHelper) {
      // A helper agent's steps: show its tool calls as indented progress, keep its text out of the reply.
      const content = (message.message?.content ?? []) as Record<string, any>[];
      content.forEach((part) => {
        if (part.type === ContentType.TOOL_USE) callbacks.onEvent({ kind: EventKind.TOOL, text: `↳ ${summarizeToolInput(part.name, part.input)}` });
      });
      return;
    }
    if (message.type === StreamType.ASSISTANT) {
      // The finished message replaces the live draft.
      if (live.draft) pushLive({ draft: '' });
      const callUsage = message.message?.usage as Record<string, unknown> | undefined;
      if (callUsage) {
        const size = Number(callUsage.input_tokens ?? 0) + Number(callUsage.cache_read_input_tokens ?? 0) + Number(callUsage.cache_creation_input_tokens ?? 0);
        if (size > 0) contextTokens = size;
      }
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
      // Anything already sent is still processed after EOF, so ending input here never drops a message.
      closeInput();
      resultText = typeof message.result === 'string' ? message.result : '';
      resultError = message.is_error === true;
      if (message.session_id) callbacks.onSession?.(message.session_id);
      const rawUsage = (message.usage ?? {}) as Record<string, unknown>;
      const modelUsage = (message.modelUsage ?? {}) as Record<string, Record<string, unknown>>;
      const modelKey = Object.keys(modelUsage)[0];
      const modelEntry = modelKey ? modelUsage[modelKey] : undefined;
      const inputTokens = Number(rawUsage.input_tokens ?? modelEntry?.inputTokens ?? 0);
      const outputTokens = Number(rawUsage.output_tokens ?? modelEntry?.outputTokens ?? 0);
      const cacheReadTokens = Number(rawUsage.cache_read_input_tokens ?? modelEntry?.cacheReadInputTokens ?? 0);
      const cacheWriteTokens = Number(rawUsage.cache_creation_input_tokens ?? modelEntry?.cacheCreationInputTokens ?? 0);
      const costUsd = typeof message.total_cost_usd === 'number'
        ? message.total_cost_usd
        : typeof message.cost_usd === 'number'
          ? message.cost_usd
          : typeof modelEntry?.costUSD === 'number'
            ? modelEntry.costUSD
            : undefined;
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens > 0 || costUsd !== undefined) {
        // A follow-up queued at the very end runs as its own turn with its own result, so add them up.
        totals.inputTokens += inputTokens;
        totals.outputTokens += outputTokens;
        totals.cacheReadTokens += cacheReadTokens;
        totals.cacheWriteTokens += cacheWriteTokens;
        if (costUsd !== undefined) {
          totals.costUsd += costUsd;
          totals.hasCost = true;
        }
        questUsage = {
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheWriteTokens: totals.cacheWriteTokens,
          costUsd: totals.hasCost ? totals.costUsd : undefined,
          model: modelKey,
          contextTokens: contextTokens || undefined,
        };
        callbacks.onQuestUsage?.(questUsage);
      }
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
        usage: questUsage,
      });
    };
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
  });

  return {
    cancel: () => {
      cancelled = true;
      closeInput();
      child.kill('SIGTERM');
    },
    done,
    send: (text: string) => {
      if (!inputOpen || cancelled || timedOut) return false;
      child.stdin.write(userLine(text));
      return true;
    },
  };
};
