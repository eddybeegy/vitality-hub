import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  CheckCircle2, 
  Trash2, 
  AlertCircle, 
  Users, 
  UserCheck, 
  UserX,
  RefreshCw,
  Mail,
  Settings
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';

interface User {
  id: number;
  email: string;
  approved: number;
  role: string;
  show_debug_logs: number;
}

export function AdminPanel() {
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [systemConfig, setSystemConfig] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [purgeUserId, setPurgeUserId] = useState<number | null>(null);
  const [purgeOptions, setPurgeOptions] = useState({
    metrics: true,
    workouts: true,
    routines: true,
    insights: true,
    logs: false,
    chat: false
  });

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const [usersRes, configRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/config')
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data);
      }
      if (configRes.ok) {
        const config = await configRes.json();
        setSystemConfig(config);
      }
      setError(null);
    } catch (err) {
      setError('Network error fetching admin data');
    } finally {
      setIsLoading(false);
    }
  };

  const updateConfig = async (key: string, value: string) => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      if (res.ok) {
        setSystemConfig(prev => ({ ...prev, [key]: value }));
      } else {
        setError('Failed to update system configuration');
      }
    } catch (err) {
      setError('Error updating system configuration');
    } finally {
      setConfigSaving(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApprove = async (userId: number) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/approve`, { method: 'POST' });
      if (res.ok) {
        setUsers(users.map(u => u.id === userId ? { ...u, approved: 1 } : u));
      } else {
        setError('Failed to approve user');
      }
    } catch (err) {
      setError('Error approving user');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (userId: number) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reject`, { method: 'POST' });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== userId));
        setConfirmDelete(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to reject user');
      }
    } catch (err) {
      setError('Error rejecting user');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleDebug = async (userId: number, enabled: boolean) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/toggle-debug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      if (res.ok) {
        setUsers(users.map(u => u.id === userId ? { ...u, show_debug_logs: enabled ? 1 : 0 } : u));
      } else {
        setError('Failed to toggle debug logs');
      }
    } catch (err) {
      setError('Error toggling debug logs');
    } finally {
      setActionLoading(null);
    }
  };


  const handlePurge = async (userId: number) => {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purgeOptions)
      });
      if (res.ok) {
        setPurgeUserId(null);
        if (userId === currentUser?.id) {
          alert('Data purged successfully. The application will now reload to clear local state.');
          window.location.reload();
        } else {
          alert('Data purged successfully for user ID ' + userId);
        }
      } else {
        setError('Failed to purge data');
      }
    } catch (err) {
      setError('Error purging data');
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCw size={32} className="animate-spin text-emerald-500 mb-4" />
        <p className="text-zinc-500 font-medium">Loading user management...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Shield size={20} />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Admin Console</h2>
            <p className="text-zinc-500 dark:text-zinc-400">Manage user access and permissions {currentUser && <span className="text-[10px] opacity-50 ml-2">(Your ID: {currentUser.id})</span>}</p>
          </div>
        </div>
        <button 
          onClick={fetchUsers}
          className="flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <RefreshCw size={14} /> Refresh List
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 p-4 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400">
          <AlertCircle size={20} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl border border-black/5 dark:border-white/5 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Settings size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold">System Configuration</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage global application settings</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Global system settings and configurations can be managed here.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {users.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 p-12 rounded-3xl border border-black/5 dark:border-white/5 text-center">
            <Users size={48} className="mx-auto text-zinc-200 dark:text-zinc-800 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">No users found in the system.</p>
          </div>
        ) : (
          users.map((u) => (
            <React.Fragment key={u.id}>
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500">
                  <Mail size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-zinc-900 dark:text-zinc-100">{u.email}</h3>
                    {u.role === 'admin' && (
                      <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase rounded-md">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">User ID: {u.id}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-4 mr-2">
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-bold uppercase text-zinc-400 dark:text-zinc-500 mb-1">User Debug</span>
                    <button
                      onClick={() => handleToggleDebug(u.id, !u.show_debug_logs)}
                      disabled={actionLoading === u.id}
                      className={`w-10 h-5 rounded-full p-1 transition-colors ${u.show_debug_logs ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}
                    >
                      <div className={`w-3 h-3 bg-white rounded-full transition-transform ${u.show_debug_logs ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  
                </div>

                <div className="flex items-center gap-2 mr-4">
                  {u.approved ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-full">
                      <CheckCircle2 size={14} />
                      <span className="text-xs font-bold uppercase tracking-wider">Approved</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-full">
                      <AlertCircle size={14} />
                      <span className="text-xs font-bold uppercase tracking-wider">Pending</span>
                    </div>
                  )}
                </div>

                {!u.approved && (
                  <button
                    onClick={() => handleApprove(u.id)}
                    disabled={actionLoading === u.id}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-500/20"
                  >
                    {actionLoading === u.id ? <RefreshCw size={14} className="animate-spin" /> : <UserCheck size={14} />}
                    Approve
                  </button>
                )}

                {currentUser?.id === 1 && (
                  <button
                    onClick={() => setPurgeUserId(purgeUserId === u.id ? null : u.id)}
                    className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                  >
                    <Trash2 size={14} />
                    Purge Data
                  </button>
                )}

                {u.id !== 1 && (
                  <div className="flex items-center gap-2">
                    {confirmDelete === u.id ? (
                      <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 p-1 rounded-xl border border-red-200 dark:border-red-900/50">
                        <button
                          onClick={() => handleReject(u.id)}
                          disabled={actionLoading === u.id}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 px-3 py-1.5 text-xs font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(u.id)}
                        disabled={actionLoading === u.id}
                        className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 text-red-600 dark:text-red-400 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                      >
                        {actionLoading === u.id ? <RefreshCw size={14} className="animate-spin" /> : <UserX size={14} />}
                        {u.approved ? 'Remove' : 'Reject'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>

            {purgeUserId === u.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl p-6 mt-2 space-y-4"
              >
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                  <AlertCircle size={18} />
                  <h4 className="font-bold text-sm uppercase tracking-wider">Purge Data Options</h4>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-500 mb-4">
                  Select the data types you want to permanently delete for this user. This action cannot be undone.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {Object.entries(purgeOptions).map(([key, value]) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer group">
                      <div 
                        onClick={() => setPurgeOptions(prev => ({ ...prev, [key]: !value }))}
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          value 
                            ? 'bg-amber-500 border-amber-500 text-white' 
                            : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700'
                        }`}
                      >
                        {value && <CheckCircle2 size={12} />}
                      </div>
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 capitalize">
                        {key}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-3 pt-4 border-t border-amber-200/50 dark:border-amber-900/30">
                  <button
                    onClick={() => setPurgeUserId(null)}
                    className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePurge(u.id)}
                    disabled={actionLoading === u.id || !Object.values(purgeOptions).some(v => v)}
                    className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-6 py-2 rounded-xl text-xs font-bold transition-all shadow-lg shadow-amber-600/20 flex items-center gap-2"
                  >
                    {actionLoading === u.id ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Confirm Purge
                  </button>
                </div>
              </motion.div>
            )}
          </React.Fragment>
        ))
      )}
    </div>
    </div>
  );
}
