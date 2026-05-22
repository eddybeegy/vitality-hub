import React, { useState, useEffect } from 'react';
import { HealthChart } from './HealthChart';

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

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
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
  }, [type, props.defaultGranularity, aggregation]);

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
