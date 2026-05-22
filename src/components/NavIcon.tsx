import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface NavIconProps {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
}

export function NavIcon({ icon, active, onClick, className, title }: NavIconProps) {
  return (
    <motion.button 
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={title}
      className={cn(
        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200",
        active 
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-lg shadow-zinc-200 dark:shadow-none" 
          : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100",
        className
      )}
    >
      {icon}
    </motion.button>
  );
}
