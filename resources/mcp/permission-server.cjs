const http = require('http');
const readline = require('readline');

const PORT = Number(process.env.THQ_PORT);
const TOKEN = process.env.THQ_TOKEN || '';
const QUEST = process.env.THQ_QUEST || '';
const TOOL_NAME = 'approve';
const ASK_TOOL = 'ask_creature';
const SCHEDULE_TOOL = 'schedule_quest';
const METHOD_NOT_FOUND = -32601;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const post = (path, payload, fallback) =>
  new Promise((resolve) => {
    const body = JSON.stringify({ questId: QUEST, ...payload });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-thq-token': TOKEN, 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(fallback);
          }
        });
      },
    );
    req.on('error', () => resolve(fallback));
    req.end(body);
  });

const askHost = (toolName, input) =>
  post('/approve', { tool_name: toolName, input }, { behavior: 'deny', message: 'Trainer HQ is not reachable.' });

const askCreature = (creature, question) =>
  post('/ask', { creature, question }, { answer: 'Trainer HQ is not reachable.' });

const scheduleQuest = (input) =>
  post('/schedule', { prompt: input.prompt, cadence: input.cadence, time: input.time, weekday: input.weekday }, { answer: 'Trainer HQ is not reachable.' });

const tools = [
  {
    name: TOOL_NAME,
    description: 'Ask the Trainer HQ user to approve or deny a tool call.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string' },
        input: { type: 'object' },
        tool_use_id: { type: 'string' },
      },
      required: ['tool_name', 'input'],
    },
  },
  {
    name: ASK_TOOL,
    description: 'Ask another creature in your Trainer HQ party a question or hand it a task, and wait for its answer. Use the creature id from your roster. Include all context it needs; it cannot see your conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        creature: { type: 'string', description: 'Creature id or name, for example polybyte' },
        question: { type: 'string', description: 'The full question or task, with context' },
      },
      required: ['creature', 'question'],
    },
  },
  {
    name: SCHEDULE_TOOL,
    description: 'Create a recurring quest in Trainer HQ: the app sends you the prompt on a schedule, in this same chat, and the user can pause or delete it in the Quests tab. Use this for anything that should repeat (a daily refresh, a weekly report). Session crons, loops and background sleeps stop when your reply ends, so they never fire.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full instruction to run each time, with links and context. It must make sense on its own.' },
        cadence: { type: 'string', enum: ['hourly', 'daily', 'weekdays', 'weekly'] },
        time: { type: 'string', description: 'Local 24-hour time HH:MM, for example 00:00. Hourly uses only the minutes.' },
        weekday: { type: 'number', description: 'For weekly: 0 is Sunday, 6 is Saturday.' },
      },
      required: ['prompt', 'cadence', 'time'],
    },
  },
];

const handle = async (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'thq', version: '0.1.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const args = (params && params.arguments) || {};
    if (params && params.name === ASK_TOOL) {
      const reply = await askCreature(String(args.creature || ''), String(args.question || ''));
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(reply.answer || '') }] } });
      return;
    }
    if (params && params.name === SCHEDULE_TOOL) {
      const reply = await scheduleQuest(args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(reply.answer || '') }] } });
      return;
    }
    const decision = await askHost(args.tool_name, args.input || {});
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `Unknown method ${method}` } });
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch {
    return;
  }
});
