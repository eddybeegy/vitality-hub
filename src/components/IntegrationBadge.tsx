import React from 'react';
import { cn } from '../lib/utils';

interface IntegrationBadgeProps {
  name: string;
  status: string;
  color: string;
}

export function IntegrationBadge({ name, status, color }: IntegrationBadgeProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50/50 dark:bg-zinc-800/50">
      <div className={cn("w-2 h-2 rounded-full", color)} />
      <div>
        <p className="text-sm font-semibold leading-none mb-1 text-zinc-900 dark:text-zinc-100">{name}</p>
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-bold tracking-widest">{status}</p>
      </div>
    </div>
  );
}
