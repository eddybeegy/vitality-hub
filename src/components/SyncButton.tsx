import React from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface SyncButtonProps {
  onClick: () => void;
  isSyncing: boolean;
  className?: string;
  label?: string;
}

export const SyncButton: React.FC<SyncButtonProps> = ({ onClick, isSyncing, className, label = "Sync" }) => {
  return (
    <button 
      onClick={onClick}
      disabled={isSyncing}
      className={cn(
        "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-black/5 dark:border-white/5 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all disabled:opacity-50",
        className
      )}
    >
      <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />
      {isSyncing ? "Syncing..." : label}
    </button>
  );
};
