import React from 'react';
import { motion } from 'motion/react';
import { Clock } from 'lucide-react';

interface SyncStatusProps {
  lastSyncStr?: string;
  sourceName?: string;
  className?: string;
}

export const SyncStatus = ({ lastSyncStr, sourceName, className }: SyncStatusProps) => {
  if (!lastSyncStr) return null;
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-md text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors ${className || 'absolute top-4 right-4'}`} title={`Last synced from ${sourceName || 'source'}`}>
      <Clock size={10} />
      <span>{sourceName ? `${sourceName}: ` : ''}{lastSyncStr}</span>
    </div>
  );
};
