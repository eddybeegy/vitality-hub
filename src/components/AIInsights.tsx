import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BarChart3, HeartPulse, Calendar, RefreshCw, Dumbbell, Send, User, Bot, Check, AlertCircle } from 'lucide-react';
import { ChatMessage } from '../services/geminiService';
import { InsightSkeleton } from './ui/Skeleton';
import { logToServer, getLocalDateString, formatDateWithTimezone } from '../lib/utils';

interface ApplyProgressionButtonProps {
  data: string;
}

const ApplyProgressionButton: React.FC<ApplyProgressionButtonProps> = ({ data }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleApply = async () => {
    try {
      setStatus('loading');
      setErrorMessage('');
      
      // Clean the data string
      const cleanData = data.trim();
      const startIndex = cleanData.indexOf('{');
      const endIndex = cleanData.lastIndexOf('}');
      
      if (startIndex === -1 || endIndex === -1) {
        throw new Error("Invalid format: No JSON object found in the progression block.");
      }
      
      const jsonStr = cleanData.substring(startIndex, endIndex + 1);
      const parsed = JSON.parse(jsonStr);
      
      if (!parsed.routine_external_id) {
         throw new Error("No routine ID found for this workout. This usually means the workout wasn't linked to a Hevy routine.");
      }

      const res = await fetch('/api/hevy/update-routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update routine');

      setStatus('success');
      setTimeout(() => setStatus('idle'), 5000);
    } catch (e: any) {
      console.error('Apply progression error:', e);
      setStatus('error');
      setErrorMessage(e.message);
      setTimeout(() => setStatus('idle'), 10000);
    }
  };

  const getLabel = () => {
    if (status === 'loading') return 'Applying...';
    if (status === 'success') return 'Applied!';
    if (status === 'error') return 'Apply Failed';
    return 'Apply Progressions';
  };

  return (
    <div className="my-8 pb-4 border-b border-zinc-100 dark:border-zinc-800">
      <button 
        onClick={handleApply}
        disabled={status !== 'idle'}
        className={`w-full sm:w-auto px-8 py-4 rounded-2xl text-sm font-black tracking-tighter uppercase transition-all shadow-xl flex items-center justify-center gap-3 border-b-4 ${
          status === 'success' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 
          status === 'error' ? 'bg-red-50 border-red-500 text-red-700' :
          'bg-blue-600 border-blue-800 text-white hover:bg-blue-700 hover:border-blue-900 scale-100 hover:scale-[1.02] active:scale-95 shadow-blue-200 dark:shadow-none'
        } disabled:opacity-70 disabled:scale-100`}
      >
        {status === 'loading' ? (
          <RefreshCw size={14} className="animate-spin" />
        ) : status === 'success' ? (
          <Check size={14} />
        ) : status === 'error' ? (
          <AlertCircle size={14} />
        ) : (
          <Dumbbell size={14} />
        )}
        {getLabel()}
      </button>
      {status === 'error' && (
        <p className="mt-1 text-[10px] text-red-500 font-medium ml-1">{errorMessage}</p>
      )}
    </div>
  );
};

interface AIInsightsProps {
  nutritionVitalsReview: any | null;
  workoutProgressionReview: any | null;
  insightsLastUpdated: Record<string, string>;
  isReviewLoading: boolean;
  checkAndRegenerateAI: (force: boolean, currentTargets?: any[], settings?: any, specificType?: string) => Promise<void>;
  chatHistory: ChatMessage[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isChatLoading: boolean;
  handleChatSubmit: (message: string, date: string, currentChatHistory: ChatMessage[]) => Promise<string | null>;
  allAIInsights: any[];
  timezone?: string;
  selectedBatchId: string | null;
  setSelectedBatchId: (batchId: string | null) => void;
  fetchChatHistory: (date: string, batchId?: string | null) => Promise<void>;
  mode: 'nutrition' | 'workout';
}

export const AIInsights: React.FC<AIInsightsProps> = ({
  nutritionVitalsReview: currentNutritionReview,
  workoutProgressionReview: currentWorkoutReview,
  insightsLastUpdated,
  isReviewLoading,
  checkAndRegenerateAI,
  chatHistory,
  setChatHistory,
  isChatLoading,
  handleChatSubmit,
  allAIInsights,
  timezone,
  selectedBatchId,
  setSelectedBatchId,
  fetchChatHistory,
  mode,
}) => {
  const [chatInput, setChatInput] = useState('');
  const today = getLocalDateString(timezone);
  const [selectedDate, setSelectedDate] = useState<string>(today);

  const onSubmit = async () => {
    if (!chatInput.trim()) return;
    const message = chatInput;
    const date = selectedDate;
    setChatInput('');
    
    const newUserMessage: ChatMessage = { role: 'user', content: message };
    setChatHistory(prev => [...prev, newUserMessage]);
    
    const response = await handleChatSubmit(message, date, chatHistory);
    if (response) {
      fetchChatHistory(selectedDate, selectedBatchId);
    }
  };

  // Get unique dates from allAIInsights, sorted descending
  // Ensure today is always in the list so the Regenerate button is never hidden
  const availableDates = Array.from(new Set([today, ...allAIInsights.map(i => i.date || today)])).sort((a, b) => b.localeCompare(a));

  // Fetch chat history when selectedDate or selectedBatchId changes
  React.useEffect(() => {
    fetchChatHistory(selectedDate, selectedBatchId);
  }, [selectedDate, selectedBatchId, fetchChatHistory]);


  // If selectedDate is not in availableDates and availableDates is not empty, set it to the most recent
  React.useEffect(() => {
    if (availableDates.length > 0 && !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const getInsightForDate = (type: string) => {
    const insight = allAIInsights.find(i => {
      const dateMatch = i.date === selectedDate || (!i.date && selectedDate === today);
      const batchMatch = !selectedBatchId || i.batch_id === selectedBatchId;
      return i.type === type && dateMatch && batchMatch;
    });

    if (selectedDate === today && (!selectedBatchId || (currentNutritionReview?.batch_id === selectedBatchId || currentWorkoutReview?.batch_id === selectedBatchId))) {
      return {
        content: type === 'nutrition_vitals' ? currentNutritionReview?.text : currentWorkoutReview?.text,
        updated_at: insightsLastUpdated[type],
        provider: type === 'nutrition_vitals' ? currentNutritionReview?.provider : currentWorkoutReview?.provider,
        model: type === 'nutrition_vitals' ? currentNutritionReview?.model : currentWorkoutReview?.model,
        batch_id: type === 'nutrition_vitals' ? currentNutritionReview?.batch_id : currentWorkoutReview?.batch_id
      };
    }
    
    return insight ? { 
      content: insight.content, 
      updated_at: insight.updated_at,
      provider: insight.provider,
      model: insight.model,
      batch_id: insight.batch_id
    } : { content: null, updated_at: undefined };
  };

  const nutritionVitals = getInsightForDate('nutrition_vitals');
  const workoutProgression = getInsightForDate('workout_progression');

  const batchesForSelectedDate = allAIInsights
    .filter(i => i.date === selectedDate)
    .reduce((acc: any[], i) => {
      if (!acc.find(b => b.id === i.batch_id)) {
        acc.push({ id: i.batch_id, time: i.updated_at });
      }
      return acc;
    }, [])
    .sort((a, b) => b.time.localeCompare(a.time));

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    return formatDateWithTimezone(dateStr, timezone);
  };


  const renderMarkdown = (
    content: string | null, 
    title: string, 
    icon: React.ReactNode, 
    lastUpdated: string | undefined, 
    color: string, 
    provider?: string, 
    model?: string,
    type?: string
  ) => {
    const formattedLastUpdated = formatDate(lastUpdated);

    return (
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center text-white shadow-md`}>
            {icon}
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {formattedLastUpdated && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">Updated: {formattedLastUpdated}</span>
              )}
              {provider && (
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-medium">• Generated by {provider} ({model})</span>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // This triggers regeneration for ONLY this insight type
                checkAndRegenerateAI(true, undefined, undefined, type);
              }}
              disabled={isReviewLoading}
              className="bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 p-1.5 rounded-lg transition-all disabled:opacity-50"
              title="Refresh this insight"
            >
              <RefreshCw size={14} className={isReviewLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {content ? (
          <div className="prose prose-zinc dark:prose-invert max-w-none ai-response-container prose-xs">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({node, children, ...props}) => <h1 className="text-lg font-bold mb-2 text-zinc-900 dark:text-zinc-100 border-b border-black/5 dark:border-white/5 pb-1" {...props}>{children}</h1>,
                h2: ({node, children, ...props}) => <h2 className="text-base font-bold mt-4 mb-2 text-zinc-800 dark:text-zinc-200 flex items-center gap-2" {...props}>{children}</h2>,
                h3: ({node, children, ...props}) => <h3 className="text-sm font-bold mt-3 mb-1 text-zinc-700 dark:text-zinc-300" {...props}>{children}</h3>,
                p: ({node, children, ...props}) => <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2 text-xs" {...props}>{children}</p>,
                ul: ({node, children, ...props}) => <ul className="space-y-1.5 mb-3 list-none p-0" {...props}>{children}</ul>,
                li: ({node, children, ...props}) => (
                  <li className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-lg border border-black/5 dark:border-white/5 flex items-start gap-2" {...props}>
                    <div className={`w-1 h-1 rounded-full bg-emerald-500 mt-1.5 shrink-0`} />
                    <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">{children}</div>
                  </li>
                ),
                strong: ({node, children, ...props}) => <strong className="font-bold text-zinc-900 dark:text-zinc-100" {...props}>{children}</strong>,
                table: ({node, children, ...props}) => (
                  <div className="overflow-x-auto mb-4 rounded-lg border border-black/5 dark:border-white/5">
                    <table className="w-full text-left border-collapse" {...props}>{children}</table>
                  </div>
                ),
                thead: ({node, children, ...props}) => <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-black/5 dark:border-white/5" {...props}>{children}</thead>,
                th: ({node, children, ...props}) => <th className="p-2 text-[10px] font-bold text-zinc-900 dark:text-zinc-100" {...props}>{children}</th>,
                td: ({node, children, ...props}) => <td className="p-2 text-[10px] text-zinc-600 dark:text-zinc-400 border-b border-black/5 dark:border-white/5" {...props}>{children}</td>,
                code: (props) => {
                  const { children, className, node, ...rest } = props;
                  const match = /language-progression/.exec(className || '');
                  
                  // Extraction helper to get text even if children is a complex object/array
                  const extractText = (nodes: any): string => {
                    if (typeof nodes === 'string') return nodes;
                    if (typeof nodes === 'number' || typeof nodes === 'boolean') return String(nodes);
                    if (Array.isArray(nodes)) return nodes.map(extractText).join('');
                    if (nodes?.props?.children) return extractText(nodes.props.children);
                    return '';
                  };

                  if (match) {
                    const data = extractText(children);
                    return <ApplyProgressionButton data={data} />;
                  }
                  
                  return (
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  );
                },
                // Keep this for backward compatibility if old insights still use it
                // @ts-ignore
                progression_data: ({children}) => {
                  // Extract text content from children nodes
                  const extractText = (nodes: any): string => {
                    if (typeof nodes === 'string') return nodes;
                    if (typeof nodes === 'number' || typeof nodes === 'boolean') return String(nodes);
                    if (Array.isArray(nodes)) return nodes.map(extractText).join('');
                    if (nodes?.props?.children) return extractText(nodes.props.children);
                    if (nodes?.props?.nodeValue) return String(nodes.props.nodeValue);
                    return '';
                  };
                  try {
                    const data = extractText(children);
                    if (!data || !data.includes('{')) return null; // Hide if no valid-looking data
                    return <ApplyProgressionButton data={data} />;
                  } catch (e) {
                    console.error('Failed to render progression button', e);
                    return null;
                  }
                }
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (isReviewLoading && selectedDate === today) ? (
        <InsightSkeleton />
      ) : (
        <div className="flex flex-col items-center justify-center h-[200px] text-zinc-400 dark:text-zinc-500 gap-4">
          <BarChart3 size={32} className="opacity-20" />
          <p className="text-sm italic">No insights available for this date.</p>
        </div>
      )}
    </div>
  );
};

  return (
    <div className="space-y-8">
      {/* Date Scroller */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
        <div className="bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm overflow-x-auto flex-grow">
          <div className="flex gap-2 min-w-max px-2">
            {availableDates.map(date => {
              const isSelected = selectedDate === date;
              const dateObj = new Date(date);
              const dayName = date === today ? 'Today' : dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone });
              const dayNum = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: timezone }).format(dateObj));
              const monthName = dateObj.toLocaleDateString('en-US', { month: 'short', timeZone: timezone });

              return (
                <button
                  key={date}
                  onClick={() => {
                    setSelectedDate(date);
                    setSelectedBatchId(null); // Reset batch when date changes
                  }}
                  className={`flex flex-col items-center justify-center min-w-[60px] p-3 rounded-xl transition-all ${
                    isSelected 
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200 dark:shadow-none scale-105' 
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider mb-1">{dayName}</span>
                  <span className="text-lg font-black leading-none mb-1">{dayNum}</span>
                  <span className="text-[9px] font-medium opacity-80">{monthName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {batchesForSelectedDate.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm min-w-[200px]">
            <div className="px-3 pt-1 pb-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Calendar size={10} />
                Regeneration Time
              </label>
            </div>
            <select
              value={selectedBatchId || ''}
              onChange={(e) => setSelectedBatchId(e.target.value || null)}
              className="w-full bg-transparent text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none px-3 pb-1"
            >
              <option value="">Latest Generation</option>
              {batchesForSelectedDate.map(batch => (
                <option key={batch.id} value={batch.id}>
                  {formatDate(batch.time)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {mode === 'nutrition' && renderMarkdown(
        nutritionVitals.content, 
        'Nutrition & Vitals', 
        <HeartPulse size={18} />, 
        nutritionVitals.updated_at, 
        'bg-emerald-600',
        nutritionVitals.provider,
        nutritionVitals.model,
        'nutrition_vitals'
      )}
      {mode === 'workout' && renderMarkdown(
        workoutProgression.content, 
        'Workout Progression', 
        <Dumbbell size={18} />, 
        workoutProgression.updated_at, 
        'bg-blue-600',
        workoutProgression.provider,
        workoutProgression.model,
        'workout_progression'
      )}
      
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-black/5 dark:border-white/5 shadow-sm">
        <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mb-4">Ask AI about your data</h2>
        <div className="space-y-4 mb-4 h-[300px] overflow-y-auto pr-2">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-700 rounded-full flex items-center justify-center shrink-0"><Bot size={16} /></div>}
              <div className={`p-3 rounded-2xl text-xs ${msg.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'}`}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-zinc dark:prose-invert max-w-none prose-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === 'user' && <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900 rounded-full flex items-center justify-center shrink-0"><User size={16} /></div>}
            </div>
          ))}
          {isChatLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-700 rounded-full flex items-center justify-center shrink-0"><Bot size={16} /></div>
              <div className="p-3 rounded-2xl text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 animate-pulse">Thinking...</div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <input 
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder="Ask a question..."
            className="flex-grow px-4 py-3 rounded-xl border border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all text-zinc-900 dark:text-zinc-100"
          />
          <button 
            type="button"
            onClick={onSubmit}
            disabled={isChatLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl transition-all disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIInsights;
