import React, { useState, useEffect, useRef } from 'react';
import { HealthChart } from './HealthChart';
import { useHealthStore } from '../store/useHealthStore';

interface AggregatedChartProps {
  type: string;
  title: string;
  dataKey: string;
  aggregation?: 'sum' | 'avg';
  [key: string]: any;
}

export const AggregatedHealthChart: React.FC<AggregatedChartProps> = ({ 
  type, title, dataKey, aggregation = 'avg', ...props 
}) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Item 26: refetch silently when a long-lived tab regains focus.
  const focusRefreshNonce = useHealthStore(state => state.focusRefreshNonce);
  const lastFetchKey = useRef<string | null>(null);

  useEffect(() => {
    const fetchKey = `${type}|${props.defaultGranularity}|${aggregation}`;
    const isFocusRefresh = lastFetchKey.current === fetchKey;
    lastFetchKey.current = fetchKey;
    const fetchData = async () => {
      if (!isFocusRefresh) setLoading(true);
      try {
        // For now, default to 365 days
        const response = await fetch(`/api/metrics/aggregated?type=${type}&granularity=${props.defaultGranularity || 'day'}&aggregation=${aggregation}&startDate=${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()}`);
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error("Failed to fetch aggregated data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [type, props.defaultGranularity, aggregation, focusRefreshNonce]);

  return (
    <HealthChart 
      data={data} 
      title={title} 
      dataKey={dataKey} 
      aggregation={aggregation} 
      loading={loading}
      {...props} 
    />
  );
};
