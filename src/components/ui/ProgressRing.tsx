import React from 'react';
import { motion } from 'motion/react';

interface ProgressRingProps {
  radius?: number;
  stroke?: number;
  progress: number;
  color?: string;
  trackColor?: string;
  label?: string;
  value?: string;
  sublabel?: string;
}

export const ProgressRing = ({ 
  radius = 40, 
  stroke = 8, 
  progress = 0, 
  color = '#10b981', 
  trackColor,
  label,
  value,
  sublabel
}: ProgressRingProps) => {
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (Math.max(0, Math.min(100, progress)) / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg
        height={radius * 2}
        width={radius * 2}
        className="transform -rotate-90"
      >
        <circle
          stroke={trackColor || "currentColor"}
          className="text-zinc-100 dark:text-zinc-800"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <motion.circle
          stroke={color}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center text-center">
        {value && <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-none mb-0.5">{value}</span>}
        {label && <span className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{label}</span>}
        {sublabel && <span className="text-[9px] text-zinc-400 mt-1">{sublabel}</span>}
      </div>
    </div>
  );
};
