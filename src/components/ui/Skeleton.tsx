import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton = ({ className, style }: SkeletonProps) => {
  return (
    <div 
      className={cn(
        "animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded-md",
        className
      )} 
      style={style}
    />
  );
};

export const ChartSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm h-[400px] flex flex-col gap-4", className)}>
    <div className="flex justify-between items-start">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-8 w-32" />
    </div>
    <div className="flex-1 flex items-end gap-2">
      {[...Array(12)].map((_, i) => (
        <Skeleton 
          key={i} 
          className="flex-1" 
          style={{ height: `${Math.random() * 60 + 20}%` }} 
        />
      ))}
    </div>
  </div>
);

export const CardSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm space-y-4", className)}>
    <Skeleton className="h-10 w-10 rounded-xl" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-24" />
    </div>
  </div>
);

export const InsightSkeleton = () => (
  <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm space-y-4">
    <div className="flex justify-between items-center">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-24" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[90%]" />
      <Skeleton className="h-4 w-[95%]" />
      <Skeleton className="h-4 w-[80%]" />
    </div>
  </div>
);
