import { create } from 'zustand';

interface User {
  id: number;
  email: string;
  name?: string;
  approved: number;
  role: string;
}

interface AuthState {
  user: User | null;
  isAuthChecking: boolean;
  setUser: (user: User | null) => void;
  setIsAuthChecking: (isChecking: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthChecking: true,
  setUser: (user) => set({ user }),
  setIsAuthChecking: (isAuthChecking) => set({ isAuthChecking }),
}));
