import React from 'react';
import { motion } from 'motion/react';
import { AIInsights } from './AIInsights';

interface AIInsightsTabProps {
  combinedReview: any;
  insightsLastUpdated: Record<string, string>;
  isReviewLoading: boolean;
  checkAndRegenerateAI: (force?: boolean, currentTargets?: any[], settings?: any, specificType?: string) => Promise<void>;
  chatHistory: any[];
  setChatHistory: (history: any[]) => void;
  isChatLoading: boolean;
  handleChatSubmit: (message: string, date: string, currentChatHistory: any[]) => Promise<string | null>;
  allAIInsights: any[];
  timezone: string;
  selectedBatchId: string | null;
  setSelectedBatchId: (batchId: string | null) => void;
  fetchChatHistory: (date: string, batchId?: string | null) => Promise<void>;
}

export const AIInsightsTab: React.FC<AIInsightsTabProps> = React.memo(({
  combinedReview,
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
}) => {
  return (
    <motion.div
      key="ai-insights"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      <AIInsights
        combinedReview={combinedReview}
        insightsLastUpdated={insightsLastUpdated}
        isReviewLoading={isReviewLoading}
        checkAndRegenerateAI={checkAndRegenerateAI}
        chatHistory={chatHistory}
        setChatHistory={setChatHistory}
        isChatLoading={isChatLoading}
        handleChatSubmit={handleChatSubmit}
        allAIInsights={allAIInsights}
        timezone={timezone}
        selectedBatchId={selectedBatchId}
        setSelectedBatchId={setSelectedBatchId}
        fetchChatHistory={fetchChatHistory}
      />
    </motion.div>
  );
});
