import { create } from 'zustand';

type Tab = 'dashboard' | 'activity' | 'workouts' | 'nutrition' | 'settings' | 'profile' | 'ai-nutrition' | 'ai-workout' | 'logs' | 'debug' | 'targets' | 'admin' | 'metric-priority' | 'dashboard-layout';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  visible: boolean;
}

interface UIState {
  activeTab: Tab;
  selectedRoutine: any | null;
  toast: ToastState;
  setActiveTab: (tab: Tab) => void;
  setSelectedRoutine: (routine: any | null) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  hideToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'dashboard',
  selectedRoutine: null,
  toast: { message: '', type: 'success', visible: false },
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedRoutine: (selectedRoutine) => set({ selectedRoutine }),
  showToast: (message, type = 'success') => set({ toast: { message, type, visible: true } }),
  hideToast: () => set((state) => ({ toast: { ...state.toast, visible: false } })),
}));
