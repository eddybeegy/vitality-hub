import { create } from 'zustand';
import { ChatMessage } from '../services/geminiService';
import { fetchJson, fetchOk } from '../lib/apiFetch';

interface AIState {
  chatHistory: ChatMessage[];
  isChatLoading: boolean;
  isReviewLoading: boolean;
  combinedReview: any | null;
  allAIInsights: any[];
  insightsLastUpdated: Record<string, string>;
  regenPending: Record<string, boolean>;
  regenNotice: Record<string, string | null>;
  aiProviders: any[];
  selectedBatchId: string | null;
  setChatHistory: (history: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setIsChatLoading: (isLoading: boolean) => void;
  setAIProviders: (updater: any[] | ((prev: any[]) => any[])) => void;
  setCombinedReview: (review: any | null) => void;
  setAllAIInsights: (insights: any[] | ((prev: any[]) => any[])) => void;
  setInsightsLastUpdated: (updated: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setSelectedBatchId: (batch_id: string | null) => void;
  fetchAIInsights: () => Promise<void>;
  fetchAIProviders: () => Promise<void>;
  fetchChatHistory: (date: string, batchId?: string | null) => Promise<void>;
  handleChatSubmit: (message: string, date: string, currentChatHistory: ChatMessage[], settings: any, targets: any) => Promise<string | null>;
  checkAndRegenerateAI: (force?: boolean, currentTargets?: any[], settings?: any, specificType?: string) => Promise<void>;
  requestRegeneration: (type: string) => Promise<void>;
  saveAIInsight: (type: string, content: string, date?: string, provider?: string, model?: string, batch_id?: string, updated_at?: string) => Promise<void>;
}

export const useAIStore = create<AIState>((set, get) => ({
  chatHistory: [],
  isChatLoading: false,
  isReviewLoading: false,
  combinedReview: null,
  allAIInsights: [],
  insightsLastUpdated: {},
  regenPending: {},
  regenNotice: {},
  aiProviders: [],
  selectedBatchId: null,
  setChatHistory: (updater) => set((state) => ({
    chatHistory: typeof updater === 'function' ? updater(state.chatHistory) : updater
  })),
  setIsChatLoading: (isChatLoading) => set({ isChatLoading }),
  setAIProviders: (updater) => set((state) => ({
    aiProviders: typeof updater === 'function' ? updater(state.aiProviders) : updater
  })),
  setCombinedReview: (combinedReview) => set({ combinedReview }),
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

        // Find today's combined insight
        const { getLocalDateString } = await import('../lib/utils');
        const { useSettingsStore } = await import('./useSettingsStore');
        const timezone = useSettingsStore.getState().settings?.timezone;
        const today = getLocalDateString(timezone);
        const { selectedBatchId } = get();

        let combined = null;

        if (selectedBatchId) {
          combined = insightsArray.find((i: any) => i.type === 'combined' && i.batch_id === selectedBatchId);
        } else {
          combined = insightsArray.find((i: any) => i.type === 'combined' && i.date === today);

          // If we found today's insight but didn't have a batch selected, select the latest batch
          if (combined && !get().selectedBatchId) set({ selectedBatchId: combined.batch_id });
        }

        if (combined) set({ combinedReview: { text: combined.content, provider: combined.provider, model: combined.model, updated_at: combined.updated_at, batch_id: combined.batch_id } });
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
      await fetchOk('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, date, provider, model, batch_id, updated_at })
      });
    } catch (e) {
      console.error("Save AI insight failed", e);
    }
  },
  /**
   * Ask coach to regenerate an insight now (Option E replacement for the old
   * force=true Gemini bypass, 2026-10-19).
   *
   * The server returns as soon as the run is QUEUED — coach is an agent turn,
   * so the new content lands a minute or two later via its own POST. There is
   * no completion callback to wait on, so this polls the insight's updated_at
   * until it moves. The notice is what the user sees instead of the old silent
   * no-op; it's deliberately set in every branch, including failure.
   */
  requestRegeneration: async (type: string) => {
    const { regenPending, insightsLastUpdated, fetchAIInsights } = get();
    if (regenPending[type]) return;

    const before = insightsLastUpdated[type];
    const setPending = (pending: boolean) =>
      set((state) => ({ regenPending: { ...state.regenPending, [type]: pending } }));
    const notify = (message: string | null) =>
      set((state) => ({ regenNotice: { ...state.regenNotice, [type]: message } }));

    setPending(true);
    notify('Asking coach to regenerate — this usually takes a minute or two.');
    try {
      const res = await fetch('/api/ai/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 429) {
        const secs = data?.retry_after_seconds;
        notify(
          secs
            ? `Just regenerated — try again in about ${Math.ceil(secs / 60)} min.`
            : 'Just regenerated — try again shortly.',
        );
        setPending(false);
        return;
      }
      if (!res.ok || data?.status !== 'queued') {
        notify("Couldn't reach coach to regenerate. The scheduled run will still happen.");
        setPending(false);
        return;
      }

      // Queued. Poll for the row to change; coach writes it back when done.
      const DEADLINE_MS = 4 * 60_000;
      const INTERVAL_MS = 10_000;
      const startedAt = Date.now();
      while (Date.now() - startedAt < DEADLINE_MS) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
        await fetchAIInsights();
        const now = get().insightsLastUpdated[type];
        if (now && now !== before) {
          notify('Updated just now by coach.');
          setPending(false);
          return;
        }
      }
      // Still running, most likely — the turn outlives our patience, not the
      // other way round, so say so rather than reporting a failure.
      notify('Coach is still working on it. It will appear here when it lands.');
    } catch (e) {
      console.error('requestRegeneration failed', e);
      notify("Couldn't reach coach to regenerate. The scheduled run will still happen.");
    } finally {
      setPending(false);
    }
  },
  checkAndRegenerateAI: async (force = false, currentTargets, settings, specificType) => {
    const { isReviewLoading, fetchAIInsights } = get();
    if (isReviewLoading) {
      return;
    }

    // Always fetch latest insights first
    if (!force) {
      await fetchAIInsights();
      return;
    }

    set({ isReviewLoading: true });
    try {
      const type = specificType || 'combined';
      // A failed force run is logged, but the list is still refreshed as before.
      await fetchOk(`/api/ai/insights?force=true&type=${type}`).catch(e => console.error('Forced insight run failed', e));
      await fetchAIInsights();
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
      // Saving either side of the turn to history is logged on failure but never
      // aborts the chat -- above all not after the user already has the reply.
      const saveTurn = (body: object) =>
        fetchOk('/api/chat-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).catch(e => console.error('Save chat history failed', e));

      // Save user message
      await saveTurn({ role: 'user', content: message, date, batch_id: selectedBatchId });

      // chatWithData (server-side since the coach move) reads only `chatDate` from
      // commonData, so this slice is unused; a failed fetch is logged and the chat goes
      // ahead rather than aborting on a request it doesn't need.
      const data: any = await fetchJson('/api/ai/data').catch(e => {
        console.error('Fetch AI data failed', e);
        return {};
      });

      const { combinedReview, allAIInsights } = get();
      const today = new Date().toISOString().split('T')[0];
      let combinedInsight = null;

      if (date === today) {
        combinedInsight = combinedReview?.text || null;
      } else {
        const cInsight = allAIInsights.find(i => i.type === 'combined' && i.date === date);
        combinedInsight = cInsight ? cInsight.content : null;
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
        combinedInsightForDate: combinedInsight,
        chatDate: date
      };

      const { chatWithData } = await import('../services/geminiService');
      const modelToUse = settings.ai_model || "gemini-3-pro-preview";
      const providerToUse = settings.ai_provider || "gemini";
      const response = await chatWithData(commonData, message, currentChatHistory, modelToUse, providerToUse);
      if (response) {
        // Save assistant message
        await saveTurn({ role: 'assistant', content: response, date, batch_id: selectedBatchId });
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
