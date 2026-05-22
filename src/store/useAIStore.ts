import { create } from 'zustand';
import { ChatMessage } from '../services/geminiService';

interface AIState {
  chatHistory: ChatMessage[];
  isChatLoading: boolean;
  isReviewLoading: boolean;
  nutritionVitalsReview: any | null;
  workoutProgressionReview: any | null;
  allAIInsights: any[];
  insightsLastUpdated: Record<string, string>;
  aiProviders: any[];
  selectedBatchId: string | null;
  setChatHistory: (history: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setIsChatLoading: (isLoading: boolean) => void;
  setAIProviders: (updater: any[] | ((prev: any[]) => any[])) => void;
  setNutritionVitalsReview: (review: any | null) => void;
  setWorkoutProgressionReview: (review: any | null) => void;
  setAllAIInsights: (insights: any[] | ((prev: any[]) => any[])) => void;
  setInsightsLastUpdated: (updated: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setSelectedBatchId: (batch_id: string | null) => void;
  fetchAIInsights: () => Promise<void>;
  fetchAIProviders: () => Promise<void>;
  fetchChatHistory: (date: string, batchId?: string | null) => Promise<void>;
  handleChatSubmit: (message: string, date: string, currentChatHistory: ChatMessage[], settings: any, targets: any) => Promise<string | null>;
  checkAndRegenerateAI: (force?: boolean, currentTargets?: any[], settings?: any, specificType?: string) => Promise<void>;
  saveAIInsight: (type: string, content: string, date?: string, provider?: string, model?: string, batch_id?: string, updated_at?: string) => Promise<void>;
}

export const useAIStore = create<AIState>((set, get) => ({
  chatHistory: [],
  isChatLoading: false,
  isReviewLoading: false,
  nutritionVitalsReview: null,
  workoutProgressionReview: null,
  allAIInsights: [],
  insightsLastUpdated: {},
  aiProviders: [],
  selectedBatchId: null,
  setChatHistory: (updater) => set((state) => ({
    chatHistory: typeof updater === 'function' ? updater(state.chatHistory) : updater
  })),
  setIsChatLoading: (isChatLoading) => set({ isChatLoading }),
  setAIProviders: (updater) => set((state) => ({
    aiProviders: typeof updater === 'function' ? updater(state.aiProviders) : updater
  })),
  setNutritionVitalsReview: (nutritionVitalsReview) => set({ nutritionVitalsReview }),
  setWorkoutProgressionReview: (workoutProgressionReview) => set({ workoutProgressionReview }),
  setAllAIInsights: (updater) => set((state) => ({
    allAIInsights: typeof updater === 'function' ? updater(state.allAIInsights) : updater
  })),
  setInsightsLastUpdated: (updater) => set((state) => ({
    insightsLastUpdated: typeof updater === 'function' ? updater(state.insightsLastUpdated) : updater
  })),
  setSelectedBatchId: (selectedBatchId) => set({ selectedBatchId }),
  fetchAIProviders: async () => {
    try {
      const res = await fetch('/api/ai/providers');
      if (res.ok) {
        const data = await res.json();
        set({ aiProviders: data.providers });
        
        // Expose constraints globally for the service to use
        const constraints: Record<string, any> = {};
        data.providers.forEach((p: any) => {
          constraints[p.id] = p.constraints;
        });
        (window as any).__AI_PROVIDERS = constraints;
      }
    } catch (e) {
      console.error("Fetch AI providers failed", e);
    }
  },
  fetchAIInsights: async () => {
    try {
      const res = await fetch('/api/ai/insights');
      if (res.ok) {
        const data = await res.json();
        const insightsArray = data.insights || data;
        
        set({
          allAIInsights: insightsArray,
          insightsLastUpdated: insightsArray.reduce((acc: any, i: any) => {
            if (!acc[i.type]) {
              acc[i.type] = i.updated_at;
            }
            return acc;
          }, {})
        });
        
        // Find today's insights
        const { getLocalDateString } = await import('../lib/utils');
        const { useSettingsStore } = await import('./useSettingsStore');
        const timezone = useSettingsStore.getState().settings?.timezone;
        const today = getLocalDateString(timezone);
        const { selectedBatchId } = get();
        
        let nutrition = null;
        let workout = null;
        
        if (selectedBatchId) {
          nutrition = insightsArray.find((i: any) => i.type === 'nutrition_vitals' && i.batch_id === selectedBatchId);
          workout = insightsArray.find((i: any) => i.type === 'workout_progression' && i.batch_id === selectedBatchId);
        } else {
          nutrition = insightsArray.find((i: any) => i.type === 'nutrition_vitals' && i.date === today);
          workout = insightsArray.find((i: any) => i.type === 'workout_progression' && i.date === today);
          
          // If we found today's insights but didn't have a batch selected, select the latest batch
          if (nutrition && !get().selectedBatchId) set({ selectedBatchId: nutrition.batch_id });
          else if (workout && !get().selectedBatchId) set({ selectedBatchId: workout.batch_id });
        }
        
        if (nutrition) set({ nutritionVitalsReview: { text: nutrition.content, provider: nutrition.provider, model: nutrition.model, updated_at: nutrition.updated_at, batch_id: nutrition.batch_id } });
        if (workout) set({ workoutProgressionReview: { text: workout.content, provider: workout.provider, model: workout.model, updated_at: workout.updated_at, batch_id: workout.batch_id } });
      }
    } catch (e) {
      console.error("Fetch AI insights failed", e);
    }
  },
  fetchChatHistory: async (date, batchId) => {
    try {
      const url = `/api/chat-history?date=${date}${batchId ? `&batch_id=${batchId}` : ''}`;
      const res = await fetch(url);
      if (res.ok) {
        const history = await res.json();
        set({ chatHistory: history });
      }
    } catch (e) {
      console.error("Fetch chat history failed", e);
    }
  },
  saveAIInsight: async (type, content, date, provider, model, batch_id, updated_at) => {
    try {
      await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, date, provider, model, batch_id, updated_at })
      });
    } catch (e) {
      console.error("Save AI insight failed", e);
    }
  },
  checkAndRegenerateAI: async (force = false, currentTargets, settings, specificType) => {
    console.log("checkAndRegenerateAI called", { force, currentTargets, settings, specificType });
    const { isReviewLoading, fetchAIInsights } = get();
    if (isReviewLoading) {
      console.log("checkAndRegenerateAI: already loading, returning");
      return;
    }

    // Always fetch latest insights first
    if (!force) {
      await fetchAIInsights();
      return;
    }

    set({ isReviewLoading: true });
    try {
      if (specificType) {
        // Generate only the requested type serially, then fetch and update
        await fetch(`/api/ai/insights?force=true&type=${specificType}`);
        await fetchAIInsights();
      } else {
        // Generate all types serially one after another, updating the state after each one completes!
        const types = ['nutrition_vitals', 'workout_progression'];
        for (const type of types) {
          console.log(`Starting sequential generation of ${type}...`);
          await fetch(`/api/ai/insights?force=true&type=${type}`);
          await fetchAIInsights();
          console.log(`Finished sequential generation of ${type} and updated page!`);
        }
      }
    } catch (e) {
      console.error("checkAndRegenerateAI failed", e);
    } finally {
      set({ isReviewLoading: false });
    }
  },
  handleChatSubmit: async (message, date, currentChatHistory, settings, targets) => {
    if (!message.trim()) return null;

    const { selectedBatchId } = get();
    set({ isChatLoading: true });
    try {
      // Save user message
      await fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: message, date, batch_id: selectedBatchId })
      });

      const res = await fetch('/api/ai/data');
      const data = await res.json();
      
      const { nutritionVitalsReview, workoutProgressionReview, allAIInsights } = get();
      const today = new Date().toISOString().split('T')[0];
      let nutritionInsight = null;
      let workoutInsight = null;
      
      if (date === today) {
        nutritionInsight = nutritionVitalsReview;
        workoutInsight = workoutProgressionReview;
      } else {
        const nInsight = allAIInsights.find(i => i.type === 'nutrition_vitals' && i.date === date);
        const wInsight = allAIInsights.find(i => i.type === 'workout_progression' && i.date === date);
        nutritionInsight = nInsight ? nInsight.content : null;
        workoutInsight = wInsight ? wInsight.content : null;
      }

      const commonData = {
        metrics: data.metrics,
        workouts: data.workouts,
        routines: data.routines,
        routineExercises: data.routineExercises,
        exercises: data.exercises,
        sets: data.sets,
        mealItems: data.mealItems,
        age: settings.age || 30,
        gender: settings.gender || 'male',
        targets: targets,
        medications: settings.medications || [],
        timezone: settings.timezone || 'UTC',
        ai_persona: settings.ai_persona || 'Encouraging Coach',
        ai_focus: settings.ai_focus || 'General Health',
        aiHints: settings.ai_hints || '',
        aiInsightsForDate: {
          nutrition: nutritionInsight,
          workout: workoutInsight
        },
        chatDate: date
      };

      const { chatWithData } = await import('../services/geminiService');
      const modelToUse = settings.ai_model || "gemini-3-pro-preview";
      const providerToUse = settings.ai_provider || "gemini";
      const response = await chatWithData(commonData, message, currentChatHistory, modelToUse, providerToUse);
      if (response) {
        // Save assistant message
        await fetch('/api/chat-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: response, date, batch_id: selectedBatchId })
        });
        return response;
      }
    } catch (e: any) {
      console.error("Chat failed", e);
    } finally {
      set({ isChatLoading: false });
    }
    return null;
  },
}));
