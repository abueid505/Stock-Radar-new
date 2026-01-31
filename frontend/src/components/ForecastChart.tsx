import { useRef, useEffect, useState } from 'react';
import { createChart, ColorType, LineStyle, LineSeries, HistogramSeries, Time } from 'lightweight-charts';

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

function calculateMomentum(prices: number[]): number[] {
  const momentum: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < 3) {
      momentum.push(0);
    } else {
      const change = prices[i] - prices[i - 3];
      const avgVolatility = Math.abs(prices[i] - prices[i - 1]) + Math.abs(prices[i - 1] - prices[i - 2]) + Math.abs(prices[i - 2] - prices[i - 3]);
      momentum.push(change * (1 + avgVolatility / prices[i] * 10));
    }
  }
  return momentum;
}

interface ForecastChartProps {
  historicalData: ChartDataPoint[];
  timeframe: string;
  currentPrice: number;
  analystTarget?: number | null;
  goldenTakeProfit?: number | null;
  onForecastData?: (peak: number, valley: number, momentum: string) => void;
}

function ForecastChart({ historicalData, timeframe, currentPrice, analystTarget, goldenTakeProfit, onForecastData }: ForecastChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [flashingAlert, setFlashingAlert] = useState(false);

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
      height: 280,
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
    const momentum = calculateMomentum(prices);

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

    // Support Zone (shaded area around lower band) - using thin line as visual indicator
    const supportZoneSeries = chart.addSeries(LineSeries, {
      color: 'rgba(34, 197, 94, 0.5)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const supportZoneData = lowerBandData.map(d => ({
      time: d.time,
      value: d.value * 0.98,
    }));
    supportZoneSeries.setData(supportZoneData);

    const lowerBandSeries = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: 'Support',
    });
    lowerBandSeries.setData(lowerBandData);

    // Resistance Zone (shaded area around upper band) - using thin line as visual indicator
    const resistanceZoneSeries = chart.addSeries(LineSeries, {
      color: 'rgba(239, 68, 68, 0.5)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const resistanceZoneData = upperBandData.map(d => ({
      time: d.time,
      value: d.value * 1.02,
    }));
    resistanceZoneSeries.setData(resistanceZoneData);

    const upperBandSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: 'Resistance',
    });
    upperBandSeries.setData(upperBandData);

    // Momentum Bars (Volume + Momentum visualization)
    const momentumBarData = historicalLineData.map((d, i) => {
      const mom = momentum[i] || 0;
      const normalizedMom = mom / (stdDev * 2);
      return {
        time: d.time,
        value: Math.abs(normalizedMom) * 3,
        color: mom >= 0 ? '#22c55e' : '#ef4444',
      };
    });

    const momentumSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'momentum',
    });
    momentumSeries.setData(momentumBarData);

    chart.priceScale('momentum').applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    // Golden Take-Profit Line
    if (goldenTakeProfit && goldenTakeProfit > 0) {
      const goldenLineData = [
        { time: historicalLineData[0].time, value: goldenTakeProfit },
        { time: (lastHistoricalTime + (forecastPoints * Math.floor(intervalMs / 1000))) as Time, value: goldenTakeProfit },
      ];
      const goldenLineSeries = chart.addSeries(LineSeries, {
        color: '#fbbf24',
        lineWidth: 3,
        lineStyle: LineStyle.Solid,
        title: 'Take Profit',
      });
      goldenLineSeries.setData(goldenLineData);
    }

    // Analyst Target Line
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

    // Determine momentum status
    const recentMomentum = momentum.slice(-5);
    const avgMomentum = recentMomentum.reduce((a, b) => a + b, 0) / recentMomentum.length;
    let momentumStatus = 'neutral';
    if (avgMomentum > stdDev * 0.3) {
      momentumStatus = 'buying';
    } else if (avgMomentum < -stdDev * 0.3) {
      momentumStatus = 'selling';
    }

    // Check for flashing alert condition (price near support with positive momentum)
    const priceNearSupport = currentPrice <= valleyValue * 1.02;
    const positiveMomentum = avgMomentum > 0;
    if (priceNearSupport && positiveMomentum) {
      setFlashingAlert(true);
    } else {
      setFlashingAlert(false);
    }

    if (onForecastData) {
      onForecastData(peakValue, valleyValue, momentumStatus);
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
  }, [historicalData, timeframe, currentPrice, analystTarget, goldenTakeProfit, onForecastData]);

  return (
    <div className="relative">
      {flashingAlert && (
        <div className="absolute top-2 right-2 z-10 px-3 py-1 bg-green-500 text-black text-xs font-bold rounded-full animate-pulse shadow-lg shadow-green-500/50">
          BUY SIGNAL
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-[280px]" />
    </div>
  );
}

export default ForecastChart;
