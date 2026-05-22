import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ArrowRight, CheckCircle2, ChevronRight, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useHealthStore } from '../store/useHealthStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { calculateReadinessScore } from '../lib/readiness';
import { getSmartTargetAdjustments } from '../services/geminiService';
import { calculateAge, getLocalDateString } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const SmartAdjustments: React.FC = () => {
    const { summaryData } = useHealthStore();
    const { settings, targets } = useSettingsStore();
    const [loading, setLoading] = useState(false);
    const [adjustmentData, setAdjustmentData] = useState<{ text: string, json: any } | null>(null);
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const readiness = calculateReadinessScore(summaryData.metrics || [], targets, settings.timezone);

    const CACHE_KEY = `smart_adjustments_${getLocalDateString(settings.timezone)}`;

    const fetchAdjustments = async () => {
        if (!readiness) return;
        setLoading(true);
        setError(null);
        try {
            const data = await fetch('/api/ai/data').then(res => res.json());
            const age = calculateAge(settings.dob) || 30;
            const gender = settings.gender || 'male';

            const aiInput = {
                ...data,
                age,
                gender,
                readiness,
                targets,
                ai_focus: settings.ai_focus,
                ai_persona: settings.ai_persona,
                aiHints: settings.ai_hints,
                timezone: settings.timezone
            };

            const result = await getSmartTargetAdjustments(aiInput, settings.ai_model, settings.ai_provider);
            
            // Extract JSON from markdown if present
            let json = null;
            const jsonMatch = result.text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                try {
                    json = JSON.parse(jsonMatch[1]);
                } catch (e) {
                    console.error("Failed to parse adjustment JSON", e);
                }
            }

            const newData = { text: result.text, json };
            setAdjustmentData(newData);
            setUpdatedAt(new Date().toISOString());
            
            // Cache for today in DB
            await fetch(`/api/ai/cache/${CACHE_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newData })
            });
        } catch (e) {
            console.error("Failed to fetch smart adjustments", e);
            setError("Could not generate smart adjustments. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Load from DB cache on mount
        const loadCache = async () => {
            try {
                const res = await fetch(`/api/ai/cache/${CACHE_KEY}`);
                const cached = await res.json();
                if (cached && cached.content) {
                    setAdjustmentData(cached.content);
                    if (cached.updated_at) setUpdatedAt(cached.updated_at);
                }
            } catch (e) {
                console.error("Failed to load cached adjustments from DB", e);
            }
        };

        if (readiness) {
            loadCache();
        }
    }, [CACHE_KEY, !!readiness]);

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
                        onClick={fetchAdjustments}
                        disabled={loading}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

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
                            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest animate-pulse font-serif italic">Analyzing recovery state...</p>
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
                                onClick={fetchAdjustments}
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
                            <p className="text-zinc-400 text-xs italic tracking-wide">Generate dynamic goals optimized for your recovery score</p>
                            <button 
                                onClick={fetchAdjustments}
                                className="px-6 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-amber-500/20 hover:bg-amber-600 transition-all font-serif italic"
                            >
                                Get Smart Advice
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
