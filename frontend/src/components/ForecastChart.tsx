import { useRef, useEffect } from 'react';
import { createChart, ColorType, LineStyle, LineSeries, Time } from 'lightweight-charts';

interface ChartDataPoint {
  date: string;
  price: number;
  is_peak: boolean;
  is_valley: boolean;
}

function linearRegression(data: number[]): { slope: number; intercept: number } {
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += data[i];
    sumXY += i * data[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function calculateStdDev(data: number[]): number {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const squaredDiffs = data.map(x => Math.pow(x - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / data.length);
}

interface ForecastChartProps {
  historicalData: ChartDataPoint[];
  timeframe: string;
  currentPrice: number;
  analystTarget?: number | null;
  onForecastData?: (peak: number, valley: number) => void;
}

function ForecastChart({ historicalData, timeframe, currentPrice, analystTarget, onForecastData }: ForecastChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || historicalData.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#27272a' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#3f3f46' },
        horzLines: { color: '#3f3f46' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 220,
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
      },
    });

    chartRef.current = chart;

    const prices = historicalData.map(d => d.price);
    const { slope, intercept } = linearRegression(prices);
    const stdDev = calculateStdDev(prices);

    const now = new Date();
    let forecastPoints: number;
    let intervalMs: number;
    
    if (timeframe === '1d') {
      forecastPoints = 24;
      intervalMs = 60 * 60 * 1000;
    } else if (timeframe === '1w') {
      forecastPoints = 7;
      intervalMs = 24 * 60 * 60 * 1000;
    } else {
      forecastPoints = 30;
      intervalMs = 24 * 60 * 60 * 1000;
    }

    const historicalLineData = historicalData.map((d, i) => {
      const baseTime = now.getTime() - (historicalData.length - i) * intervalMs;
      return {
        time: Math.floor(baseTime / 1000) as Time,
        value: d.price,
      };
    });

    const historicalSeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      title: 'Historical',
    });
    historicalSeries.setData(historicalLineData);

    const lastHistoricalTime = historicalLineData[historicalLineData.length - 1].time as number;
    const predictedData: { time: Time; value: number }[] = [];
    const upperBandData: { time: Time; value: number }[] = [];
    const lowerBandData: { time: Time; value: number }[] = [];

    let peakValue = -Infinity;
    let valleyValue = Infinity;

    for (let i = 0; i <= forecastPoints; i++) {
      const futureTime = lastHistoricalTime + (i * Math.floor(intervalMs / 1000));
      const predictedPrice = intercept + slope * (prices.length + i);
      const noise = (Math.random() - 0.5) * stdDev * 0.3;
      const finalPrice = Math.max(predictedPrice + noise, currentPrice * 0.8);
      
      predictedData.push({ time: futureTime as Time, value: finalPrice });
      upperBandData.push({ time: futureTime as Time, value: finalPrice + stdDev * 1.5 });
      lowerBandData.push({ time: futureTime as Time, value: Math.max(finalPrice - stdDev * 1.5, currentPrice * 0.7) });

      if (finalPrice + stdDev * 1.5 > peakValue) {
        peakValue = finalPrice + stdDev * 1.5;
      }
      if (finalPrice - stdDev * 1.5 < valleyValue) {
        valleyValue = Math.max(finalPrice - stdDev * 1.5, currentPrice * 0.7);
      }
    }

    const predictedSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: 'Forecast',
    });
    predictedSeries.setData(predictedData);

    const upperBandSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: 'Upper Band',
    });
    upperBandSeries.setData(upperBandData);

    const lowerBandSeries = chart.addSeries(LineSeries, {
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: 'Lower Band',
    });
    lowerBandSeries.setData(lowerBandData);

    if (analystTarget && analystTarget > 0) {
      const analystTargetData = [
        { time: historicalLineData[0].time, value: analystTarget },
        { time: (lastHistoricalTime + (forecastPoints * Math.floor(intervalMs / 1000))) as Time, value: analystTarget },
      ];
      const analystTargetSeries = chart.addSeries(LineSeries, {
        color: '#a855f7',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: 'Analyst Target',
      });
      analystTargetSeries.setData(analystTargetData);
    }

    if (onForecastData) {
      onForecastData(peakValue, valleyValue);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [historicalData, timeframe, currentPrice, analystTarget, onForecastData]);

  return <div ref={chartContainerRef} className="w-full h-[220px]" />;
}

export default ForecastChart;
