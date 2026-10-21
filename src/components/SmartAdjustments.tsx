import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ArrowRight, CheckCircle2, ChevronRight, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useHealthStore } from '../store/useHealthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAIStore } from '../store/useAIStore';
import { calculateReadinessScore } from '../lib/readiness';
import { getLocalDateString } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const SmartAdjustments: React.FC = () => {
    const { summaryData } = useHealthStore();
    const { settings, targets } = useSettingsStore();
    const { allAIInsights, fetchAIInsights, requestRegeneration, regenPending, regenNotice } = useAIStore();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const readiness = calculateReadinessScore(summaryData.metrics || [], targets, settings.timezone);

    const today = getLocalDateString(settings.timezone);

    // 2026-10-18 (Option E): this widget used to call an LLM from the browser and
    // stash the answer in user_cache under smart_adjustments_<date>. Generation is
    // coach's now — it pre-bakes the day's advice early each morning (the prompt is
    // explicitly "today only", driven by last night's sleep and HRV, so it has to
    // land before the day is spent) and writes it to ai_insights as type
    // 'smart_adjustments' via its allowlisted POST /api/ai/insights. So this is a
    // read of today's row. The refresh button was briefly a refetch-only no-op
    // after that demotion; since 2026-10-19 it triggers a real on-demand coach
    // run via POST /api/ai/regenerate (see requestRegeneration in useAIStore).
    const insight = React.useMemo(
        () => (allAIInsights || []).find((i: any) => i.type === 'smart_adjustments' && i.date === today),
        [allAIInsights, today]
    );

    const adjustmentData = React.useMemo(() => {
        if (!insight?.content) return null;
        // The fenced JSON block is the card contract: adjustments[].{type,current,
        // suggested,unit,reason}. A malformed block degrades to prose only, which is
        // silent by design but worth knowing about when coach's output changes.
        let json = null;
        const jsonMatch = insight.content.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            try {
                json = JSON.parse(jsonMatch[1]);
            } catch (e) {
                console.error("Failed to parse adjustment JSON", e);
            }
        }
        return { text: insight.content as string, json };
    }, [insight]);

    const updatedAt = insight?.updated_at || null;

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            await fetchAIInsights();
        } catch (e) {
            console.error("Failed to refresh smart adjustments", e);
            setError("Could not load today's smart adjustments. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    // Ask coach to redo today's adjustments now. Distinct from `refresh` above,
    // which is still the right action for the error-state retry: that one failed
    // to LOAD, so it should try loading again, not spend an agent turn.
    const pending = !!regenPending['smart_adjustments'];
    const notice = regenNotice['smart_adjustments'];
    const regenerate = () => { void requestRegeneration('smart_adjustments'); };

    useEffect(() => {
        if (readiness && !(allAIInsights || []).length) {
            fetchAIInsights().catch(e => console.error("Failed to load smart adjustments", e));
        }
    }, [!!readiness]);

    if (!readiness) return null;

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm overflow-hidden h-full flex flex-col">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <Sparkles size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 italic">Smart Target Adjustments</h3>
                        <p className="text-[10px] text-zinc-500 font-medium">AI-driven dynamic goals based on readiness</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {updatedAt && !loading && (
                        <div className="hidden sm:flex flex-col items-end">
                            <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Last Sync</span>
                            <span className="text-[10px] font-medium text-zinc-500">{new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
                    <button 
                        onClick={regenerate}
                        disabled={loading || pending}
                        title={pending ? 'Coach is regenerating this' : "Ask coach to redo today's adjustments"}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600 disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={loading || pending ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {notice && (
                <div className="px-6 pt-3 text-[10px] font-medium text-amber-600 dark:text-amber-400">{notice}</div>
            )}

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                <AnimatePresence mode="wait">
                    {loading ? (
                        <motion.div 
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-40 flex flex-col items-center justify-center space-y-4"
                        >
                            <Loader2 className="animate-spin text-amber-500" size={32} />
                            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest animate-pulse font-serif italic">Fetching today’s plan...</p>
                        </motion.div>
                    ) : error ? (
                        <motion.div 
                            key="error"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center text-center space-y-4 py-8"
                        >
                            <AlertCircle className="text-rose-500" size={32} />
                            <p className="text-sm text-zinc-500 max-w-[200px]">{error}</p>
                            <button 
                                onClick={refresh}
                                className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl text-xs font-bold transition-all"
                            >
                                Retry
                            </button>
                        </motion.div>
                    ) : adjustmentData ? (
                        <motion.div 
                            key="content"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-6"
                        >
                            {adjustmentData.json?.adjustments && (
                                <div className="grid gap-3">
                                    {adjustmentData.json.adjustments.map((adj: any, i: number) => (
                                        <div key={i} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-black/[0.02] dark:border-white/[0.02] flex items-center justify-between group">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{adj.type.replace('_', ' ')}</span>
                                                    <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-bold text-zinc-400 line-through decoration-rose-500/50 decoration-2">{adj.current}{adj.unit}</span>
                                                    <ArrowRight size={14} className="text-zinc-300" />
                                                    <span className="text-lg font-black text-amber-600 dark:text-amber-400">{adj.suggested}{adj.unit}</span>
                                                </div>
                                                <p className="text-[10px] text-zinc-500 font-medium italic mt-1">{adj.reason}</p>
                                            </div>
                                            <div className="ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <CheckCircle2 size={20} className="text-emerald-500" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="markdown-body prose dark:prose-invert prose-sm max-w-none text-zinc-600 dark:text-zinc-400 prose-p:leading-relaxed prose-li:my-0.5">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {adjustmentData.text.replace(/```json[\s\S]*?```/, '')}
                                </ReactMarkdown>
                            </div>
                        </motion.div>
                    ) : (
                        <div className="h-40 flex flex-col items-center justify-center text-center space-y-3">
                            <Sparkles className="text-zinc-200 dark:text-zinc-800" size={48} />
                            <p className="text-zinc-400 text-xs italic tracking-wide">No adjustments yet for today &mdash; your coach prepares these each morning</p>
                            <button 
                                onClick={regenerate}
                                disabled={pending}
                                className="px-6 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all font-serif italic disabled:opacity-50"
                            >
                                {pending ? 'Asking coach\u2026' : 'Generate Now'}
                            </button>
                        </div>
                    )}
                </AnimatePresence>
            </div>
            
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/30 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${readiness.score > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Current Readiness: {readiness.score}%</span>
                </div>
                <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400 italic">Today's Optimization Plan</div>
            </div>
        </div>
    );
};
