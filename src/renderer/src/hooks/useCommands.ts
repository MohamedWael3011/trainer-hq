import { useEffect, useState } from 'react';
import type { CommandInfoType } from '@shared/types';

const REFRESH_MS = 60_000;
// One lookup per creature shared by the composer and every chat log entry.
const cache = new Map<string, { at: number; list: Promise<CommandInfoType[]> }>();

const load = (creatureId: string, rev: number): Promise<CommandInfoType[]> => {
  const key = `${creatureId}#${rev}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit.list;
  const list = window.hq.listCommands(creatureId).catch(() => []);
  cache.set(key, { at: Date.now(), list });
  return list;
};

// `rev` changes when a run finishes, since a run is what tells us the exact list.
export const useCommands = (creatureId: string | undefined, rev = 0): CommandInfoType[] => {
  const [commands, setCommands] = useState<CommandInfoType[]>([]);
  useEffect(() => {
    if (!creatureId) return undefined;
    let live = true;
    void load(creatureId, rev).then((list) => {
      if (live) setCommands(list);
    });
    return () => {
      live = false;
    };
  }, [creatureId, rev]);
  return commands;
};

// The first sentence of a description, for the chat log; the full text goes in the tooltip.
export const firstSentence = (text: string): string => {
  const cut = text.search(/(?<=[.!?])\s| — /);
  return cut > 0 ? text.slice(0, cut).replace(/[.!?]$/, '') : text;
};

// The command a message starts with: "/review 123" → { name: 'review', args: '123' }.
export const parseCommand = (text: string): { name: string; args: string } | undefined => {
  const match = text.trim().match(/^\/([\w:.-]+)\s*([\s\S]*)$/);
  return match ? { name: match[1], args: match[2] } : undefined;
};
