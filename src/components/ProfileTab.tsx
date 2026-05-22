import React from 'react';
import { motion } from 'motion/react';
import { Settings } from 'lucide-react';
import { calculateAge, convertHeight, getHeightUnit } from '../lib/utils';

interface ProfileTabProps {
  user: any;
  settings: any;
  setSettings: (settings: any) => void;
  handleSaveSettings: () => void;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  user,
  settings,
  setSettings,
  handleSaveSettings,
}) => {
  return (
    <motion.div 
      key="profile"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-2xl mx-auto"
    >
      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-900 dark:text-zinc-100">
            <Settings size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">User Profile</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your personal information</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Full Name</label>
              <input 
                type="text" 
                value={settings.name || ''}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder="Your Name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">User ID</label>
              <div className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono">
                {user?.id}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Email Address</label>
              <input 
                type="email" 
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder="your@email.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Date of Birth</label>
              <div className="relative">
                <input 
                  type="date"
                  value={settings.dob}
                  onChange={(e) => setSettings({ ...settings, dob: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-md">
                  {calculateAge(settings.dob)} Years Old
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Gender</label>
              <select 
                value={settings.gender}
                onChange={(e) => setSettings({ ...settings, gender: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Height ({getHeightUnit(settings?.preferred_units)})</label>
              <input 
                type="number"
                step="0.01"
                value={convertHeight(settings.height || 0, settings?.preferred_units)}
                onChange={(e) => {
                  let val = parseFloat(e.target.value) || 0;
                  if (settings?.preferred_units === 'imperial') {
                    val = val / 39.3701; // convert inches back to meters
                  }
                  setSettings({ ...settings, height: val });
                }}
                className="w-full px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                placeholder={settings?.preferred_units === 'imperial' ? "e.g. 70" : "e.g. 1.80"}
              />
            </div>
          </div>
          <div className="pt-4">
            <button 
              onClick={handleSaveSettings}
              className="w-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 py-4 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-lg shadow-zinc-200 dark:shadow-none"
            >
              Save Profile
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
