import { randomBytes, randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Decision, type DecisionType } from '@shared/constants';
import type { ApprovalType } from '@shared/types';

type PendingType = {
  approval: ApprovalType;
  input: unknown;
  resolve: (decision: DecisionType) => void;
};

type ApprovalRequestType = {
  questId: string;
  tool_name: string;
  input: unknown;
};

const HOST = '127.0.0.1';
const SUMMARY_LIMIT = 240;
const AUTH_HEADER = 'x-thq-token';
const ROUTE = '/approve';
const ASK_ROUTE = '/ask';
const SCHEDULE_ROUTE = '/schedule';

export type AskRequestType = {
  questId: string;
  creature: string;
  question: string;
};

export type ScheduleToolRequestType = {
  questId: string;
  prompt?: string;
  cadence?: string;
  time?: string;
  weekday?: number;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

export const summarizeToolInput = (toolName: string, input: unknown): string => {
  const data = (input ?? {}) as Record<string, unknown>;
  if (toolName.endsWith('ask_creature') && typeof data.creature === 'string') {
    return `ask ${data.creature}: ${String(data.question ?? '')}`.slice(0, SUMMARY_LIMIT);
  }
  if ((toolName === 'Agent' || toolName === 'Task') && typeof data.description === 'string') {
    return `Helper agent: ${data.description}`.slice(0, SUMMARY_LIMIT);
  }
  if (toolName === 'Bash' && data.run_in_background === true && typeof data.command === 'string') {
    return `Bash (background) ${data.command}`.slice(0, SUMMARY_LIMIT);
  }
  if (toolName === 'BashOutput' || toolName === 'TaskOutput') return 'Checked on the background task';
  if (toolName === 'TodoWrite' && Array.isArray(data.todos)) return `Updated the plan (${data.todos.length} steps)`;
  const pick = data.command ?? data.file_path ?? data.path ?? data.pattern ?? data.url ?? data.query ?? data.skill;
  const text = typeof pick === 'string' ? pick : JSON.stringify(data);
  return `${toolName} ${text}`.slice(0, SUMMARY_LIMIT);
};

export class ApprovalBroker {
  readonly token = randomBytes(24).toString('hex');
  port = 0;
  private server: Server | undefined;
  private pending = new Map<string, PendingType>();
  private questAllows = new Map<string, Set<string>>();

  constructor(
    private readonly creatureForQuest: (questId: string) => string | undefined,
    private readonly onChange: () => void,
    private readonly onAsk: (request: AskRequestType) => Promise<string>,
    private readonly onSchedule: (request: ScheduleToolRequestType) => string = () => 'Scheduling is not available.',
  ) {}

  start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.headers[AUTH_HEADER] !== this.token) {
        res.writeHead(404).end();
        return;
      }
      if (req.url === ASK_ROUTE) {
        try {
          const answer = await this.onAsk(JSON.parse(await readBody(req)) as AskRequestType);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer }));
        } catch (error) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer: `Could not ask: ${(error as Error).message}` }));
        }
        return;
      }
      if (req.url === SCHEDULE_ROUTE) {
        try {
          const answer = this.onSchedule(JSON.parse(await readBody(req)) as ScheduleToolRequestType);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer }));
        } catch (error) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ answer: `Could not schedule: ${(error as Error).message}` }));
        }
        return;
      }
      if (req.url !== ROUTE) {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = JSON.parse(await readBody(req)) as ApprovalRequestType;
        const decision = await this.request(body);
        const payload = decision === Decision.DENY
          ? { behavior: 'deny', message: 'The user denied this action in Trainer HQ.' }
          : { behavior: 'allow', updatedInput: body.input };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      } catch (error) {
        res.writeHead(500).end(JSON.stringify({ behavior: 'deny', message: (error as Error).message }));
      }
    });
    return new Promise((resolve) => {
      this.server?.listen(0, HOST, () => {
        this.port = (this.server?.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private request(body: ApprovalRequestType): Promise<DecisionType> {
    if (this.questAllows.get(body.questId)?.has(body.tool_name)) return Promise.resolve(Decision.ALLOW);
    return new Promise((resolve) => {
      const approval: ApprovalType = {
        id: randomUUID(),
        questId: body.questId,
        creatureId: this.creatureForQuest(body.questId) ?? '',
        toolName: body.tool_name,
        summary: summarizeToolInput(body.tool_name, body.input),
        at: Date.now(),
      };
      this.pending.set(approval.id, { approval, input: body.input, resolve });
      this.onChange();
    });
  }

  decide(id: string, decision: DecisionType): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (decision === Decision.ALLOW_QUEST) {
      const set = this.questAllows.get(entry.approval.questId) ?? new Set<string>();
      set.add(entry.approval.toolName);
      this.questAllows.set(entry.approval.questId, set);
    }
    this.pending.delete(id);
    entry.resolve(decision);
    this.onChange();
  }

  denyAllForQuest(questId: string): void {
    Array.from(this.pending.values())
      .filter((entry) => entry.approval.questId === questId)
      .forEach((entry) => this.decide(entry.approval.id, Decision.DENY));
    this.questAllows.delete(questId);
  }

  hasPendingForQuest(questId: string): boolean {
    return Array.from(this.pending.values()).some((entry) => entry.approval.questId === questId);
  }

  list(): ApprovalType[] {
    return Array.from(this.pending.values()).map((entry) => entry.approval);
  }

  stop(): void {
    this.server?.close();
  }
}
