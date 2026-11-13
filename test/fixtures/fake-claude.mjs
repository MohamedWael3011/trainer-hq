#!/usr/bin/env node
// A stand-in for the `claude` CLI that replays a scripted stream-json run.
// FAKE_HELP_FLAGS limits which options `--help` lists (to imitate older versions).
import { appendFileSync } from 'fs';
import { basename } from 'path';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
if (args[0] === '--help') {
  const all = ['--input-format', '--include-partial-messages', '--forward-subagent-text', '--autocompact', '--effort', '--fallback-model', '--name', '--exclude-dynamic-system-prompt-sections', '--max-budget-usd', '--resume', '--model'];
  const flags = process.env.FAKE_HELP_FLAGS !== undefined ? process.env.FAKE_HELP_FLAGS.split(',').filter(Boolean) : all;
  // Like the real CLI: ~20 KB of help, written then exit(0) straight away, which truncates on a slow pipe.
  const pad = Array.from({ length: 250 }, (_, index) => `  --zz-filler-${index} <value>   ${'x'.repeat(50)}`).join('\n');
  process.stdout.write(`Usage: claude [options]\n\nOptions:\n${pad}\n${flags.map((flag) => `  ${flag} <value>   something`).join('\n')}\n\nCommands:\n  update   Update\n`);
  process.exit(0);
}

// FAKE_LOG records each run's account folder and resumed session; FAKE_LIMITED_CONFIG_DIR makes runs on
// that account hit the plan limit, and FAKE_SESSION_BY_ACCOUNT names sessions after the account.
const account = process.env.CLAUDE_CONFIG_DIR ? basename(process.env.CLAUDE_CONFIG_DIR) : 'default';
const resumeAt = args.indexOf('--resume');
if (process.env.FAKE_LOG && args[0] !== 'auth') appendFileSync(process.env.FAKE_LOG, `${JSON.stringify({ account, resume: resumeAt >= 0 ? args[resumeAt + 1] : null })}\n`);
const SESSION = process.env.FAKE_SESSION_BY_ACCOUNT ? `sess-${account}` : 'sess-1';
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const received = [];
let closed = false;
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  try {
    const content = JSON.parse(line).message.content;
    received.push(typeof content === 'string' ? content : JSON.stringify(content));
  } catch {
    received.push(line);
  }
});
lines.on('close', () => { closed = true; });

const turn = async () => {
  out({ type: 'system', subtype: 'init', session_id: SESSION });
  if (process.env.FAKE_LIMITED_CONFIG_DIR && process.env.FAKE_LIMITED_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR) {
    out({ type: 'result', result: "You've hit your 5-hour limit · resets 11:50pm", is_error: true, session_id: SESSION });
    process.exit(1);
  }
  if (process.env.FAKE_COMPACT_LOOP) {
    for (let pass = 0; pass < 3; pass += 1) {
      out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 87000, post_tokens: 54000 } });
    }
    await wait(5000);
    return;
  }
  out({ type: 'stream_event', event: { type: 'message_start', message: { usage: {} } } });
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } });
  out({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 20 } } });
  out({ type: 'system', subtype: 'task_started', task_id: 't1', description: 'Find the config' });
  out({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'text', text: 'helper says hi' }, { type: 'tool_use', name: 'Grep', input: { pattern: 'config' } }] } });
  out({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { status: 'completed' } });
  await wait(Number(process.env.FAKE_TOOL_MS ?? 50));
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'hi' }] } });
  out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 160000, post_tokens: 22000 } });
  out({ type: 'stream_event', event: { type: 'message_start', message: { usage: {} } } });
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  for (const piece of ['Hello ', 'from ', 'fake.']) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
    await wait(5);
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `Hello from fake. Heard: ${received.join(' | ')}` }], usage: { input_tokens: 5, cache_read_input_tokens: 22000, cache_creation_input_tokens: 100 } } });
  out({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 30 } } });
  out({ type: 'result', result: `Heard: ${received.join(' | ')}`, is_error: false, session_id: SESSION, usage: { input_tokens: 15, output_tokens: 50, cache_read_input_tokens: 23000, cache_creation_input_tokens: 100 }, total_cost_usd: 0.01 });
};

await wait(20);
if (args.includes('--input-format')) {
  await turn();
  while (!closed) await wait(10);
} else {
  await turn();
}
