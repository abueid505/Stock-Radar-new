import { useState, useEffect, useCallback, useRef, memo, createContext, useContext, lazy, Suspense } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { X, TrendingUp, TrendingDown, Clock, DollarSign, Percent, Settings, Globe, AlertTriangle, Bell, BellRing, Search, Pin } from 'lucide-react';

// Lazy load heavy chart library - only loads when modal opens
const LazyForecastChart = lazy(() => import('./components/ForecastChart'));

function LoadingProgressBar({ isLoading }: { isLoading: boolean }) {
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    if (isLoading) {
      setProgress(0);
      const timer1 = setTimeout(() => setProgress(30), 100);
      const timer2 = setTimeout(() => setProgress(60), 300);
      const timer3 = setTimeout(() => setProgress(80), 600);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    } else {
      setProgress(100);
      const timer = setTimeout(() => setProgress(0), 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);
  
  if (progress === 0) return null;
  
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-zinc-900">
      <div 
        className="h-full bg-gradient-to-r from-emerald-500 via-green-400 to-emerald-500 transition-all duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card className="bg-zinc-900 border-zinc-800 min-h-[176px]">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="h-6 w-16 bg-zinc-800 rounded animate-pulse mb-2"></div>
            <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse"></div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 bg-zinc-800 rounded-full animate-pulse"></div>
            <div className="h-6 w-16 bg-zinc-800 rounded animate-pulse"></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-zinc-800/50 rounded p-2">
            <div className="h-3 w-12 bg-zinc-700 rounded animate-pulse mb-1"></div>
            <div className="h-5 w-16 bg-zinc-700 rounded animate-pulse"></div>
          </div>
          <div className="bg-zinc-800/50 rounded p-2">
            <div className="h-3 w-12 bg-zinc-700 rounded animate-pulse mb-1"></div>
            <div className="h-5 w-16 bg-zinc-700 rounded animate-pulse"></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-emerald-900/20 rounded p-2">
            <div className="h-3 w-8 bg-zinc-700 rounded animate-pulse mb-1"></div>
            <div className="h-5 w-14 bg-zinc-700 rounded animate-pulse"></div>
          </div>
          <div className="bg-red-900/20 rounded p-2">
            <div className="h-3 w-8 bg-zinc-700 rounded animate-pulse mb-1"></div>
            <div className="h-5 w-14 bg-zinc-700 rounded animate-pulse"></div>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <div className="h-4 w-20 bg-zinc-800 rounded animate-pulse"></div>
          <div className="h-5 w-16 bg-zinc-800 rounded-full animate-pulse"></div>
        </div>
      </CardContent>
    </Card>
  );
}
// lightweight-charts is lazy loaded via ForecastChart component

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

type Language = 'en' | 'ar';

const translations = {
  en: {
    title: 'Stock Signals Radar',
    subtitle: 'Analysis Dashboard',
    price: 'Price',
    potentialProfit: 'Potential Profit',
    signalFreshness: 'Signal Freshness',
    current: 'Current',
    close: 'Close',
    buy: 'Buy',
    sell: 'Sell',
    shares: 'shares',
    potential: 'potential',
    justNow: 'Just now',
    minAgo: 'min ago',
    hrAgo: 'hr ago',
    daysAgo: 'days ago',
    currentPrice: 'Current Price',
    buyTarget: 'Buy Target',
    sellTarget: 'Sell Target',
    projectedForecast: 'Projected Movement Forecast',
    oneDay: '1 Day',
    oneWeek: '1 Week',
    oneMonth: '1 Month',
    historicalData: 'Historical Data',
    predictedTrend: 'Predicted Trend',
    expectedPeak: 'Expected Peak',
    supportValley: 'Support Valley',
    reasonForRecommendation: 'Reason for Recommendation',
    latestNews: 'Latest News',
    telegramSettings: 'Telegram Settings',
    botToken: 'Bot Token',
    chatId: 'Chat ID',
    saveConfiguration: 'Save Configuration',
    telegramConfigured: 'Telegram Configured',
    loading: 'Loading...',
    loadingChart: 'Loading chart...',
    failedToLoad: 'Failed to load stock details',
    enterBotToken: 'Enter your Telegram bot token',
    enterChatId: 'Enter your Telegram chat ID',
    saving: 'Saving...',
    cooldownMessage: 'Data temporarily unavailable. Please wait...',
    dataRefreshing: 'Data refreshing...',
    cacheAge: 'Data age',
    seconds: 'seconds',
    analystConsensus: 'Analyst Consensus',
    analystTarget: 'Analyst Target',
    strongBuy: 'Strong Buy',
    hold: 'Hold',
    recommendation: 'Recommendation',
    divergenceWarning: 'Divergence Warning',
    expTarget: 'Exp. Target',
    shortTerm: '1 Day',
    midTerm: '1 Week',
    longTerm: '1 Month',
    localTime: 'Local',
    estTime: 'EST',
    marketOpen: 'Market Open',
    marketClosed: 'Market Closed',
    preMarket: 'Pre-Market',
    opensIn: 'Opens in',
    closesIn: 'Closes in',
    searchPlaceholder: 'Search ticker (e.g., AAPL)',
    symbolNotFound: 'Symbol not found',
    pinned: 'Pinned',
    searching: 'Searching...',
    priceFilter: 'Price Filter',
    minPrice: 'Min Price',
    maxPrice: 'Max Price',
    applyFilter: 'Apply',
    clearFilter: 'Clear',
    noStocksInRange: 'No stocks in this price range',
  },
  ar: {
    title: 'رادار إشارات الأسهم',
    subtitle: 'لوحة التحليل',
    price: 'السعر',
    potentialProfit: 'الربح المحتمل',
    signalFreshness: 'حداثة الإشارة',
    current: 'الحالي',
    close: 'الإغلاق',
    buy: 'شراء',
    sell: 'بيع',
    shares: 'سهم',
    potential: 'محتمل',
    justNow: 'الآن',
    minAgo: 'دقيقة مضت',
    hrAgo: 'ساعة مضت',
    daysAgo: 'أيام مضت',
    currentPrice: 'السعر الحالي',
    buyTarget: 'هدف الشراء',
    sellTarget: 'هدف البيع',
    projectedForecast: 'توقعات الحركة المتوقعة',
    oneDay: 'يوم واحد',
    oneWeek: 'أسبوع واحد',
    oneMonth: 'شهر واحد',
    historicalData: 'البيانات التاريخية',
    predictedTrend: 'الاتجاه المتوقع',
    expectedPeak: 'القمة المتوقعة',
    supportValley: 'وادي الدعم',
    reasonForRecommendation: 'سبب التوصية',
    latestNews: 'آخر الأخبار',
    telegramSettings: 'إعدادات تيليجرام',
    botToken: 'رمز البوت',
    chatId: 'معرف المحادثة',
    saveConfiguration: 'حفظ الإعدادات',
    telegramConfigured: 'تم تكوين تيليجرام',
    loading: 'جاري التحميل...',
    loadingChart: 'جاري تحميل الرسم البياني...',
    failedToLoad: 'فشل في تحميل تفاصيل السهم',
    enterBotToken: 'أدخل رمز بوت تيليجرام',
    enterChatId: 'أدخل معرف المحادثة',
    saving: 'جاري الحفظ...',
    cooldownMessage: 'البيانات غير متاحة مؤقتاً. يرجى الانتظار...',
    dataRefreshing: 'جاري تحديث البيانات...',
    cacheAge: 'عمر البيانات',
    seconds: 'ثانية',
    analystConsensus: 'إجماع المحللين',
    analystTarget: 'هدف المحللين',
    strongBuy: 'شراء قوي',
    hold: 'احتفاظ',
    recommendation: 'التوصية',
    divergenceWarning: 'تحذير الانحراف',
    expTarget: 'الهدف المتوقع',
    shortTerm: 'يوم واحد',
    midTerm: 'أسبوع واحد',
    longTerm: 'شهر واحد',
    localTime: 'المحلي',
    estTime: 'التوقيت الشرقي',
    marketOpen: 'السوق مفتوح',
    marketClosed: 'السوق مغلق',
    preMarket: 'ما قبل السوق',
    opensIn: 'يفتح في',
    closesIn: 'يغلق في',
    searchPlaceholder: 'ابحث عن رمز (مثل AAPL)',
    symbolNotFound: 'الرمز غير موجود',
    pinned: 'مثبت',
    searching: 'جاري البحث...',
    priceFilter: 'فلتر السعر',
    minPrice: 'الحد الأدنى',
    maxPrice: 'الحد الأقصى',
    applyFilter: 'تطبيق',
    clearFilter: 'مسح',
    noStocksInRange: 'لا توجد أسهم في هذا النطاق السعري',
  },
};

const LanguageContext = createContext<{ lang: Language; setLang: (lang: Language) => void; t: typeof translations.en }>({
  lang: 'en',
  setLang: () => {},
  t: translations.en,
});

const useLanguage = () => useContext(LanguageContext);

function getMarketStatus(): { status: 'open' | 'closed' | 'pre_market'; countdown: string; estTime: string; localTime: string } {
  const now = new Date();
  const estOffset = -5;
  const estDate = new Date(now.getTime() + (estOffset * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const estHour = estDate.getHours();
  const estMinute = estDate.getMinutes();
  const estDay = estDate.getDay();
  
  const localTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const estTime = estDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  const isWeekend = estDay === 0 || estDay === 6;
  const preMarketStart = 4 * 60;
  const marketOpen = 9 * 60 + 30;
  const marketClose = 16 * 60;
  const currentMinutes = estHour * 60 + estMinute;
  
  let status: 'open' | 'closed' | 'pre_market' = 'closed';
  let countdown = '';
  
  if (isWeekend) {
    const daysUntilMonday = estDay === 0 ? 1 : 2;
    const hoursUntil = daysUntilMonday * 24 - estHour + 4;
    countdown = `${Math.floor(hoursUntil)}h`;
  } else if (currentMinutes >= preMarketStart && currentMinutes < marketOpen) {
    status = 'pre_market';
    const minutesUntilOpen = marketOpen - currentMinutes;
    const hours = Math.floor(minutesUntilOpen / 60);
    const mins = minutesUntilOpen % 60;
    countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  } else if (currentMinutes >= marketOpen && currentMinutes < marketClose) {
    status = 'open';
    const minutesUntilClose = marketClose - currentMinutes;
    const hours = Math.floor(minutesUntilClose / 60);
    const mins = minutesUntilClose % 60;
    countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  } else {
    if (currentMinutes < preMarketStart) {
      const minutesUntilPreMarket = preMarketStart - currentMinutes;
      const hours = Math.floor(minutesUntilPreMarket / 60);
      const mins = minutesUntilPreMarket % 60;
      countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    } else {
      const minutesUntilNextPreMarket = (24 * 60 - currentMinutes) + preMarketStart;
      const hours = Math.floor(minutesUntilNextPreMarket / 60);
      const mins = minutesUntilNextPreMarket % 60;
      countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
  }
  
  return { status, countdown, estTime, localTime };
}

function MarketStatusBar() {
  const { t } = useLanguage();
  const [marketInfo, setMarketInfo] = useState(getMarketStatus());
  
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketInfo(getMarketStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  const statusColors = {
    open: 'bg-emerald-500',
    closed: 'bg-red-500',
    pre_market: 'bg-blue-500'
  };
  
  const statusLabels = {
    open: t.marketOpen,
    closed: t.marketClosed,
    pre_market: t.preMarket
  };
  
  const countdownLabel = marketInfo.status === 'open' ? t.closesIn : t.opensIn;
  
  return (
    <div className="bg-zinc-900/80 border-b border-zinc-800 py-2 px-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            <span className="text-zinc-400">{t.localTime}:</span>
            <span className="text-white font-mono">{marketInfo.localTime}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">{t.estTime}:</span>
            <span className="text-white font-mono">{marketInfo.estTime}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusColors[marketInfo.status]} animate-pulse`}></div>
            <span className={`font-semibold ${marketInfo.status === 'open' ? 'text-emerald-400' : marketInfo.status === 'pre_market' ? 'text-blue-400' : 'text-red-400'}`}>
              {statusLabels[marketInfo.status]}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-zinc-800 px-3 py-1 rounded">
            <span className="text-zinc-400">{countdownLabel}:</span>
            <span className="text-amber-400 font-mono font-semibold">{marketInfo.countdown}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RealTimeStatusBanner({ momentumStatus }: { momentumStatus: 'buying' | 'selling' | 'neutral' }) {
  const statusConfig = {
    buying: {
      label: 'Buying Pressure - High Divergence',
      bgColor: 'bg-emerald-900/50',
      borderColor: 'border-emerald-500',
      textColor: 'text-emerald-400',
      dotColor: 'bg-emerald-500',
      icon: TrendingUp
    },
    selling: {
      label: 'Selling Pressure - Wait for Dip',
      bgColor: 'bg-red-900/50',
      borderColor: 'border-red-500',
      textColor: 'text-red-400',
      dotColor: 'bg-red-500',
      icon: TrendingDown
    },
    neutral: {
      label: 'Neutral - Sideways Movement',
      bgColor: 'bg-amber-900/50',
      borderColor: 'border-amber-500',
      textColor: 'text-amber-400',
      dotColor: 'bg-amber-500',
      icon: Clock
    }
  };

  const config = statusConfig[momentumStatus];
  const Icon = config.icon;

  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-lg px-4 py-2 flex items-center justify-center gap-3`}>
      <div className={`w-3 h-3 rounded-full ${config.dotColor} animate-pulse`}></div>
      <Icon className={`w-5 h-5 ${config.textColor}`} />
      <span className={`font-semibold ${config.textColor}`}>{config.label}</span>
    </div>
  );
}

function DemoPortfolio({ currentPrice }: { currentPrice: number }) {
  const [additionalShares, setAdditionalShares] = useState(9);
  const [mondayOpenPrice, setMondayOpenPrice] = useState(currentPrice);
  
  const originalShares = 9;
  const originalPurchasePrice = 191.08;
  const originalTotalCost = originalShares * originalPurchasePrice;
  
  const additionalTotalCost = additionalShares * mondayOpenPrice;
  const totalShares = originalShares + additionalShares;
  const totalCost = originalTotalCost + additionalTotalCost;
  const newAverageCost = totalCost / totalShares;
  
  const currentValue = totalShares * currentPrice;
  const profitLoss = currentValue - totalCost;
  const profitLossPercent = ((currentValue - totalCost) / totalCost) * 100;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-emerald-400" />
        Demo Portfolio
      </h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-zinc-500 text-xs">Original Position</p>
          <p className="text-white font-bold">{originalShares} shares @ ${originalPurchasePrice.toFixed(2)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-zinc-500 text-xs">Original Cost</p>
          <p className="text-white font-bold">${originalTotalCost.toFixed(2)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-zinc-500 text-xs">Current Price</p>
          <p className="text-emerald-400 font-bold">${currentPrice.toFixed(2)}</p>
        </div>
        <div className="bg-zinc-800 rounded-lg p-3">
          <p className="text-zinc-500 text-xs">Current Value</p>
          <p className={`font-bold ${profitLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${(originalShares * currentPrice).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="border-t border-zinc-700 pt-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">What-if Calculator</h4>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-zinc-400 text-xs">Additional Shares</Label>
            <Input
              type="number"
              value={additionalShares}
              onChange={(e) => setAdditionalShares(Math.max(0, parseInt(e.target.value) || 0))}
              className="bg-zinc-800 border-zinc-700 text-white mt-1"
              min="0"
            />
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Monday Open Price ($)</Label>
            <Input
              type="number"
              value={mondayOpenPrice}
              onChange={(e) => setMondayOpenPrice(Math.max(0, parseFloat(e.target.value) || 0))}
              className="bg-zinc-800 border-zinc-700 text-white mt-1"
              min="0"
              step="0.01"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-3 bg-zinc-800/50 rounded-lg p-3">
          <div className="text-center">
            <p className="text-zinc-500 text-xs">Total Shares</p>
            <p className="text-white font-bold text-lg">{totalShares}</p>
          </div>
          <div className="text-center">
            <p className="text-zinc-500 text-xs">New Avg Cost</p>
            <p className="text-amber-400 font-bold text-lg">${newAverageCost.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-zinc-500 text-xs">P/L</p>
            <p className={`font-bold text-lg ${profitLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {profitLoss >= 0 ? '+' : ''}{profitLossPercent.toFixed(2)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StockSignal {
  symbol: string;
  company_name: string;
  current_price: number;
  closing_price: number;
  recommended_buy_price: number;
  recommended_sell_price: number;
  signal_timestamp: string;
  num_shares: number;
  potential_profit_percent: number;
  reason: string;
  latest_news: string[];
  analyst_target_price: number | null;
  analyst_recommendation: string | null;
  analyst_strong_buy_pct: number | null;
  analyst_buy_pct: number | null;
  analyst_hold_pct: number | null;
  analyst_sell_pct: number | null;
  analyst_count: number | null;
  limited_coverage: boolean | null;
  divergence_warning: string | null;
  rsi: number | null;
  signal_strength: string | null;
  forecast_direction: string | null;
  pre_market_price: number | null;
  pre_market_gap_percent: number | null;
  is_pre_market: boolean | null;
  has_alert: boolean | null;
  alert_target_price: number | null;
  buying_pressure: string | null;
  final_signal: string | null;
  buy_button_enabled: boolean | null;
  hide_buy_target: boolean | null;
}

interface ChartDataPoint {
  date: string;
  price: number;
  is_peak: boolean;
  is_valley: boolean;
}

interface StockDetail {
  signal: StockSignal;
  chart_1d: ChartDataPoint[];
  chart_1w: ChartDataPoint[];
  chart_1m: ChartDataPoint[];
}

type SortOption = 'price' | 'profit' | 'short_term' | 'mid_term' | 'long_term' | null;

type ExpectedDuration = 'short_term' | 'mid_term' | 'long_term';

function calculateExpectedDuration(currentPrice: number, targetPrice: number): { duration: ExpectedDuration; daysToTarget: number } {
  const priceDiff = targetPrice - currentPrice;
  const avgDailyMovement = currentPrice * 0.015;
  const daysToTarget = Math.abs(priceDiff / avgDailyMovement);
  
  let duration: ExpectedDuration;
  if (daysToTarget < 1) {
    duration = 'short_term';
  } else if (daysToTarget <= 7) {
    duration = 'mid_term';
  } else {
    duration = 'long_term';
  }
  
  return { duration, daysToTarget };
}

const StockCard = memo(function StockCard({ stock, onClick, onAlertClick }: { stock: StockSignal; onClick: () => void; onAlertClick: (e: React.MouseEvent) => void }) {
  const { t } = useLanguage();
  
  const { duration } = calculateExpectedDuration(stock.current_price, stock.recommended_sell_price);
  const durationLabel = duration === 'short_term' ? t.shortTerm : duration === 'mid_term' ? t.midTerm : t.longTerm;
  const durationColor = duration === 'short_term' ? 'text-emerald-400' : duration === 'mid_term' ? 'text-green-500' : 'text-green-700';
  const durationBgColor = duration === 'short_term' ? 'bg-emerald-500/20' : duration === 'mid_term' ? 'bg-green-500/20' : 'bg-green-700/20';

  const finalSignal = stock.final_signal || 'WAIT';
  const buyButtonEnabled = stock.buy_button_enabled === true;
  const hideBuyTarget = stock.hide_buy_target === true;
  const buyingPressure = stock.buying_pressure || 'Low';
  
  const signalColors: Record<string, { bg: string; text: string; border: string }> = {
    'BUY': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500' },
    'SELL': { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500' },
    'WAIT': { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500' }
  };
  const signalStyle = signalColors[finalSignal] || signalColors['WAIT'];

  return (
    <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-600 cursor-pointer transition-all duration-200 hover:scale-[1.02] min-h-[176px] touch-manipulation" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="text-xl font-bold text-white">{stock.symbol}</h3>
            <p className="text-xs text-zinc-500 truncate max-w-32">{stock.company_name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onAlertClick}
              className={`p-1.5 rounded-full transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center ${
                stock.has_alert 
                  ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
              title={stock.has_alert ? `Alert at $${stock.alert_target_price}` : 'Set price alert'}
            >
              {stock.has_alert ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            </button>
            <Badge variant="outline" className={`${signalStyle.border} ${signalStyle.text}`}>
              {finalSignal === 'BUY' ? <TrendingUp className="w-3 h-3 mr-1" /> : finalSignal === 'SELL' ? <TrendingDown className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
              {finalSignal}
            </Badge>
          </div>
        </div>
        {stock.is_pre_market && stock.pre_market_price && (
          <div className="mb-2 p-2 bg-blue-900/30 border border-blue-700/50 rounded text-xs">
            <div className="flex justify-between">
              <span className="text-blue-400">Pre-Market</span>
              <span className="text-white font-semibold">${stock.pre_market_price.toFixed(2)}</span>
            </div>
            {stock.pre_market_gap_percent !== null && stock.pre_market_gap_percent !== undefined && (
              <div className="flex justify-between mt-1">
                <span className="text-blue-400">Gap %</span>
                <span className={stock.pre_market_gap_percent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {stock.pre_market_gap_percent >= 0 ? '+' : ''}{stock.pre_market_gap_percent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 text-sm">{t.current}</span>
            <span className="text-white font-semibold">${stock.current_price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 text-sm">Pressure</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              buyingPressure === 'High' ? 'bg-emerald-500/20 text-emerald-400' :
              buyingPressure === 'Medium' ? 'bg-amber-500/20 text-amber-400' :
              'bg-zinc-700 text-zinc-400'
            }`}>{buyingPressure}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 text-sm">RSI</span>
            <span className={`text-sm ${
              (stock.rsi || 50) < 30 ? 'text-emerald-400' :
              (stock.rsi || 50) > 70 ? 'text-red-400' :
              'text-zinc-400'
            }`}>{stock.rsi?.toFixed(1) || 'N/A'}</span>
          </div>
          <div className="border-t border-zinc-800 pt-2 mt-2">
            {!hideBuyTarget && (
              <div className="flex justify-between">
                <span className="text-emerald-500 text-sm">{t.buy}</span>
                <span className="text-emerald-400">${stock.recommended_buy_price.toFixed(2)}</span>
              </div>
            )}
            {hideBuyTarget && (
              <div className="flex justify-between">
                <span className="text-zinc-600 text-sm">{t.buy}</span>
                <span className="text-zinc-600 text-xs">Hidden (&gt;5% from price)</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-amber-500 text-sm">{t.sell}</span>
              <span className="text-amber-400">${stock.recommended_sell_price.toFixed(2)}</span>
            </div>
          </div>
          <div className="border-t border-zinc-800 pt-2 mt-2 flex justify-between items-center">
            <div className={`flex items-center text-xs px-2 py-1 rounded ${durationBgColor}`}>
              <Clock className={`w-3 h-3 mr-1 ${durationColor}`} />
              <span className={durationColor}>{t.expTarget}: {durationLabel}</span>
            </div>
            {buyButtonEnabled && (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1 h-7">
                BUY
              </Button>
            )}
          </div>
          <div className="flex justify-between items-center">
            <div className="text-zinc-400 text-xs">{stock.num_shares} {t.shares}</div>
            <div className="bg-zinc-800 rounded px-2 py-1">
              <span className={`font-semibold ${stock.potential_profit_percent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stock.potential_profit_percent >= 0 ? '+' : ''}{stock.potential_profit_percent}%
              </span>
              <span className="text-zinc-500 text-xs ml-1">{t.potential}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

// ForecastChart is now lazy loaded from ./components/ForecastChart

function StockModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { t } = useLanguage();
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('1d');
  const [goldenTakeProfit, setGoldenTakeProfit] = useState<number | null>(null);
  const [momentumStatus, setMomentumStatus] = useState<'buying' | 'selling' | 'neutral'>('neutral');
  const [divergencePercent, setDivergencePercent] = useState<number>(0);

  useEffect(() => {
    const fetchStockDetail = async () => {
      try {
        // Try the regular endpoint first (for stocks in STOCK_METADATA)
        let res = await fetch(`${API_URL}/api/stocks/${symbol}`);
        
        // If 404 or 503, try the manual stock detail endpoint (for manually added stocks)
        if (res.status === 404 || res.status === 503) {
          res = await fetch(`${API_URL}/api/stock/${symbol}/detail`);
        }
        
        if (res.ok) {
          const data = await res.json();
          setDetail(data);
        } else {
          console.error('Failed to fetch stock detail:', res.status);
        }
      } catch (err) {
        console.error('Failed to fetch stock detail:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStockDetail();
  }, [symbol]);

  const getChartData = () => {
    if (!detail) return [];
    if (activeTab === '1d') return detail.chart_1d;
    if (activeTab === '1w') return detail.chart_1w;
    return detail.chart_1m;
  };

  const chartData = getChartData();

  return (
    <div 
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div 
        className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-4xl max-h-[90vh] overflow-y-auto pointer-events-auto"
        style={{ position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex justify-between items-center z-10">
          <h2 className="text-2xl font-bold text-white">{detail?.signal.symbol} - {detail?.signal.company_name}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px]"><X className="w-6 h-6" /></Button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-500">{t.loading}</div>
        ) : detail ? (
          <div className="p-4 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-zinc-500 text-sm">{t.currentPrice}</p>
                <p className="text-white text-xl font-bold">${detail.signal.current_price.toFixed(2)}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-zinc-500 text-sm">{t.buyTarget}</p>
                <p className="text-emerald-400 text-xl font-bold">${detail.signal.recommended_buy_price.toFixed(2)}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-zinc-500 text-sm">{t.sellTarget}</p>
                <p className="text-amber-400 text-xl font-bold">${detail.signal.recommended_sell_price.toFixed(2)}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-zinc-500 text-sm">{t.potentialProfit}</p>
                <p className="text-emerald-400 text-xl font-bold">+{detail.signal.potential_profit_percent}%</p>
              </div>
            </div>
            {detail.signal.signal_strength && (
              <div className="bg-gradient-to-r from-zinc-800 to-zinc-900 rounded-lg p-4 border border-zinc-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-zinc-400 text-sm font-medium">Signal Strength</p>
                    <p className={`text-2xl font-bold ${
                      detail.signal.signal_strength === 'Strong Buy' ? 'text-emerald-400' :
                      detail.signal.signal_strength === 'Buy' ? 'text-green-400' :
                      detail.signal.signal_strength === 'Neutral/Wait' ? 'text-amber-400' :
                      'text-red-400'
                    }`}>{detail.signal.signal_strength}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-zinc-500 text-xs">Forecast</p>
                        <p className={`text-sm font-semibold ${detail.signal.forecast_direction === 'Bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {detail.signal.forecast_direction}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-zinc-500 text-xs">RSI</p>
                        <p className={`text-sm font-semibold ${
                          detail.signal.rsi && detail.signal.rsi < 30 ? 'text-emerald-400' :
                          detail.signal.rsi && detail.signal.rsi > 70 ? 'text-red-400' :
                          'text-amber-400'
                        }`}>{detail.signal.rsi}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-zinc-500 text-xs">Analyst</p>
                        <p className={`text-sm font-semibold ${
                          detail.signal.analyst_recommendation?.toLowerCase().includes('buy') ? 'text-emerald-400' :
                          detail.signal.analyst_recommendation?.toLowerCase().includes('hold') ? 'text-amber-400' :
                          'text-red-400'
                        }`}>{detail.signal.analyst_recommendation?.replace('_', ' ') || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="bg-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">{t.projectedForecast}</h3>
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="bg-zinc-900 mb-4">
                  <TabsTrigger value="1d" className="data-[state=active]:bg-zinc-700 min-h-[44px] min-w-[60px]">{t.oneDay}</TabsTrigger>
                  <TabsTrigger value="1w" className="data-[state=active]:bg-zinc-700 min-h-[44px] min-w-[60px]">{t.oneWeek}</TabsTrigger>
                  <TabsTrigger value="1m" className="data-[state=active]:bg-zinc-700 min-h-[44px] min-w-[60px]">{t.oneMonth}</TabsTrigger>
                </TabsList>
                <TabsContent value={activeTab}>
                  <RealTimeStatusBanner momentumStatus={momentumStatus} />
                  {divergencePercent !== 0 && detail.signal.analyst_target_price && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-sm">
                      <span className={`font-semibold ${divergencePercent > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        Divergence: {divergencePercent > 0 ? '+' : ''}{divergencePercent.toFixed(1)}% to ${detail.signal.analyst_target_price.toFixed(0)}
                      </span>
                      <span className="text-zinc-500">(Wall Street Target)</span>
                    </div>
                  )}
                  <div className="mt-3">
                    <Suspense fallback={<div className="w-full h-[280px] bg-zinc-800 animate-pulse rounded flex items-center justify-center text-zinc-500">{t.loadingChart}</div>}>
                      <LazyForecastChart 
                        historicalData={chartData} 
                        timeframe={activeTab} 
                        currentPrice={detail.signal.current_price}
                        analystTarget={detail.signal.analyst_target_price}
                        goldenTakeProfit={goldenTakeProfit}
                        rsi={detail.signal.rsi}
                        onForecastData={(_peak, _valley, momentum, divPercent) => {
                          setMomentumStatus(momentum as 'buying' | 'selling' | 'neutral');
                          setDivergencePercent(divPercent);
                        }}
                      />
                    </Suspense>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Label className="text-zinc-400 text-sm">Golden Take-Profit:</Label>
                    <Input
                      type="number"
                      placeholder="Enter target price"
                      value={goldenTakeProfit || ''}
                      onChange={(e) => setGoldenTakeProfit(e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-32 bg-zinc-700 border-amber-500 text-white text-sm h-8"
                      step="0.01"
                    />
                    {goldenTakeProfit && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setGoldenTakeProfit(null)}
                        className="text-zinc-400 hover:text-white h-8 px-2"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center gap-3 mt-3 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-0.5 bg-emerald-500"></div>
                      <span className="text-zinc-400">{t.historicalData}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-0.5 bg-blue-500" style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: '#3b82f6' }}></div>
                      <span className="text-zinc-400">{t.predictedTrend}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-0.5 bg-purple-500" style={{ borderStyle: 'dashed', borderWidth: '1px', borderColor: '#a855f7' }}></div>
                      <span className="text-zinc-400">Analyst Target</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-1 bg-amber-400"></div>
                      <span className="text-zinc-400">Take Profit</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-emerald-500/30 border border-emerald-500"></div>
                      <span className="text-zinc-400">Support Zone</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-red-500/30 border border-amber-500"></div>
                      <span className="text-zinc-400">Resistance</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 flex flex-col justify-end">
                        <div className="w-full h-1 bg-emerald-500"></div>
                        <div className="w-full h-1 bg-red-500 mt-0.5"></div>
                      </div>
                      <span className="text-zinc-400">Momentum</span>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            {detail.signal.divergence_warning && (
              <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <div>
                  <p className="text-amber-200 font-medium">{t.divergenceWarning}</p>
                  <p className="text-amber-300/80 text-sm">{detail.signal.divergence_warning}</p>
                </div>
              </div>
            )}
            {detail.signal.analyst_target_price && (
              <div className="bg-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">{t.analystConsensus}</h3>
                  {detail.signal.analyst_count && (
                    <span className="text-zinc-400 text-sm">Based on {detail.signal.analyst_count} Analysts</span>
                  )}
                </div>
                {detail.signal.limited_coverage && (
                  <div className="bg-amber-900/20 border border-amber-700/50 rounded-md px-3 py-2 mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-amber-300 text-sm">Limited Analyst Coverage</span>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-zinc-500 text-sm">{t.analystTarget}</p>
                    <p className="text-blue-400 text-xl font-bold">${detail.signal.analyst_target_price.toFixed(2)}</p>
                  </div>
                  {detail.signal.analyst_recommendation && (
                    <div>
                      <p className="text-zinc-500 text-sm">{t.recommendation}</p>
                      <p className="text-emerald-400 text-xl font-bold capitalize">{detail.signal.analyst_recommendation.replace('_', ' ')}</p>
                    </div>
                  )}
                </div>
                {detail.signal.analyst_strong_buy_pct !== null && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-sm w-24">{t.strongBuy}</span>
                      <div className="flex-1 bg-zinc-700 rounded-full h-3">
                        <div className="bg-emerald-500 h-3 rounded-full" style={{ width: `${detail.signal.analyst_strong_buy_pct}%` }}></div>
                      </div>
                      <span className="text-zinc-300 text-sm w-12 text-right">{detail.signal.analyst_strong_buy_pct}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-sm w-24">{t.buy}</span>
                      <div className="flex-1 bg-zinc-700 rounded-full h-3">
                        <div className="bg-green-500 h-3 rounded-full" style={{ width: `${detail.signal.analyst_buy_pct}%` }}></div>
                      </div>
                      <span className="text-zinc-300 text-sm w-12 text-right">{detail.signal.analyst_buy_pct}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-sm w-24">{t.hold}</span>
                      <div className="flex-1 bg-zinc-700 rounded-full h-3">
                        <div className="bg-amber-500 h-3 rounded-full" style={{ width: `${detail.signal.analyst_hold_pct}%` }}></div>
                      </div>
                      <span className="text-zinc-300 text-sm w-12 text-right">{detail.signal.analyst_hold_pct}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-sm w-24">{t.sell}</span>
                      <div className="flex-1 bg-zinc-700 rounded-full h-3">
                        <div className="bg-red-500 h-3 rounded-full" style={{ width: `${detail.signal.analyst_sell_pct}%` }}></div>
                      </div>
                      <span className="text-zinc-300 text-sm w-12 text-right">{detail.signal.analyst_sell_pct}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="bg-zinc-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-2">{t.reasonForRecommendation}</h3>
              <p className="text-zinc-300">{detail.signal.reason}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-2">{t.latestNews}</h3>
              <ul className="space-y-2">
                {detail.signal.latest_news.map((news, i) => (<li key={i} className="text-zinc-300 flex items-start"><span className="text-emerald-500 mr-2">•</span>{news}</li>))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-red-500">{t.failedToLoad}</div>
        )}
      </div>
    </div>
  );
}

function AlertModal({ stock, onClose, onSave }: { stock: StockSignal; onClose: () => void; onSave: () => void }) {
  const [targetPrice, setTargetPrice] = useState(stock.alert_target_price?.toString() || stock.recommended_sell_price.toFixed(2));
  const [saving, setSaving] = useState(false);

  const handleSetAlert = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/alerts/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stock.symbol, target_price: parseFloat(targetPrice) })
      });
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to set alert:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAlert = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/alerts/${stock.symbol}`, { method: 'DELETE' });
      onSave();
      onClose();
    } catch (err) {
      console.error('Failed to remove alert:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="border-b border-zinc-800 p-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-white">Price Alert</h2>
            <p className="text-sm text-zinc-400">{stock.symbol} - {stock.company_name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px]">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-zinc-800 rounded p-3">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Current Price</span>
              <span className="text-white font-semibold">${stock.current_price.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-zinc-400">Sell Target</span>
              <span className="text-amber-400">${stock.recommended_sell_price.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <Label className="text-zinc-400">Target Price for Alert</Label>
            <Input
              type="number"
              step="0.01"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="Enter target price"
              className="bg-zinc-800 border-zinc-700 text-white mt-1 text-lg"
            />
            <p className="text-xs text-zinc-500 mt-1">You will receive a Telegram notification when this price is reached.</p>
          </div>
          <div className="flex gap-2">
            {stock.has_alert && (
              <Button
                onClick={handleRemoveAlert}
                disabled={saving}
                variant="outline"
                className="flex-1 border-red-600 text-red-400 hover:bg-red-600/20"
              >
                Remove Alert
              </Button>
            )}
            <Button
              onClick={handleSetAlert}
              disabled={saving || !targetPrice}
              className={`flex-1 ${stock.has_alert ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {saving ? 'Saving...' : stock.has_alert ? 'Update Alert' : 'Set Alert'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/telegram/config`).then(res => res.json()).then(data => setConfigured(data.configured)).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/api/telegram/configure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bot_token: botToken, chat_id: chatId }) });
      setConfigured(true);
      onClose();
    } catch (err) {
      console.error('Failed to save Telegram config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="border-b border-zinc-800 p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">{t.telegramSettings}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></Button>
        </div>
        <div className="p-4 space-y-4">
          {configured && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500">{t.telegramConfigured}</Badge>}
          <div>
            <Label className="text-zinc-400">{t.botToken}</Label>
            <Input type="password" value={botToken} onChange={e => setBotToken(e.target.value)} placeholder={t.enterBotToken} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
          </div>
          <div>
            <Label className="text-zinc-400">{t.chatId}</Label>
            <Input value={chatId} onChange={e => setChatId(e.target.value)} placeholder={t.enterChatId} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
          </div>
          <Button onClick={handleSave} disabled={saving || !botToken || !chatId} className="w-full bg-emerald-600 hover:bg-emerald-700">{saving ? t.saving : t.saveConfiguration}</Button>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { lang, setLang, t } = useLanguage();
  const [stocks, setStocks] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [alertStock, setAlertStock] = useState<StockSignal | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pinnedStocks, setPinnedStocks] = useState<StockSignal[]>([]);
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [priceFilterActive, setPriceFilterActive] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load pinned stocks from localStorage on mount
  useEffect(() => {
    const savedPinnedSymbols = localStorage.getItem('pinnedStockSymbols');
    if (savedPinnedSymbols) {
      const symbols: string[] = JSON.parse(savedPinnedSymbols);
      // Fetch data for each saved symbol
      Promise.all(
        symbols.map(async (symbol) => {
          try {
            const res = await fetch(`${API_URL}/api/search/${symbol}`);
            if (res.ok) {
              const data = await res.json();
              if (data.found && data.signal) {
                return data.signal;
              }
            }
          } catch (err) {
            console.error(`Failed to load pinned stock ${symbol}:`, err);
          }
          return null;
        })
      ).then((results) => {
        const validStocks = results.filter((s): s is StockSignal => s !== null);
        setPinnedStocks(validStocks);
      });
    }
  }, []);

  // Save pinned stock symbols to localStorage whenever they change
  useEffect(() => {
    const symbols = pinnedStocks.map(s => s.symbol);
    localStorage.setItem('pinnedStockSymbols', JSON.stringify(symbols));
  }, [pinnedStocks]);

  useEffect(() => {
    const unlockAudio = () => {
      if (audioRef.current && !audioUnlocked) {
        audioRef.current.load();
        setAudioUnlocked(true);
      }
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
  }, [audioUnlocked]);

  const fetchStocks = useCallback(async (filter?: string) => {
    try {
      const url = filter ? `${API_URL}/api/stocks?sort_by=${filter}` : `${API_URL}/api/stocks`;
      const res = await fetch(url);
      
      if (res.status === 503) {
        const errorData = await res.json();
        setApiError(errorData.detail?.message || t.cooldownMessage);
        return;
      }
      
      const data = await res.json();
      if (data.stocks) {
        setStocks(data.stocks);
        setCacheAge(data.cache_age_seconds);
        setApiError(data.warning || null);
      } else if (Array.isArray(data)) {
        setStocks(data);
        setApiError(null);
      }
    } catch (err) {
      console.error('Failed to fetch stocks:', err);
      setApiError(t.cooldownMessage);
    } finally {
      setLoading(false);
    }
  }, [t.cooldownMessage]);

  const checkAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/alerts/check`, { method: 'POST' });
      const data = await res.json();
      if (data.alerts_sent && data.alerts_sent.length > 0 && audioRef.current && audioUnlocked) {
        audioRef.current.play().catch(() => {});
      }
    } catch (err) {
      console.error('Failed to check alerts:', err);
    }
  }, [audioUnlocked]);

  // Wrap fetchStocksWithPriceFilter in useCallback to avoid dependency issues
  const fetchStocksWithPriceFilterCallback = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${API_URL}/api/stocks?`;
      if (sortBy) url += `sort_by=${sortBy}&`;
      if (minPrice) url += `min_price=${minPrice}&`;
      if (maxPrice) url += `max_price=${maxPrice}&`;
      
      const res = await fetch(url);
      
      if (res.status === 503) {
        const errorData = await res.json();
        setApiError(errorData.detail?.message || t.cooldownMessage);
        return;
      }
      
      const data = await res.json();
      if (data.stocks) {
        setStocks(data.stocks);
        setCacheAge(data.cache_age_seconds);
        setApiError(data.warning || null);
      }
    } catch (err) {
      console.error('Failed to fetch stocks with price filter:', err);
      setApiError(t.cooldownMessage);
    } finally {
      setLoading(false);
    }
  }, [sortBy, minPrice, maxPrice, t.cooldownMessage]);

  useEffect(() => {
    // Initial fetch - respect price filter if active
    if (priceFilterActive) {
      fetchStocksWithPriceFilterCallback();
    } else {
      fetchStocks(sortBy || undefined);
    }
    
    // Set up intervals - respect price filter state
    const stockInterval = setInterval(() => {
      if (priceFilterActive) {
        fetchStocksWithPriceFilterCallback();
      } else {
        fetchStocks(sortBy || undefined);
      }
    }, 30000);
    const alertInterval = setInterval(checkAlerts, 60000);
    return () => { clearInterval(stockInterval); clearInterval(alertInterval); };
  }, [fetchStocks, fetchStocksWithPriceFilterCallback, checkAlerts, sortBy, priceFilterActive]);

  const handleSort = (option: SortOption) => {
    const newSort = sortBy === option ? null : option;
    setSortBy(newSort);
    setLoading(true);
    fetchStocks(newSort || undefined);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    setSearchError(null);
    
    try {
      const res = await fetch(`${API_URL}/api/search/${searchQuery.trim().toUpperCase()}`);
      if (res.status === 404) {
        setSearchError(t.symbolNotFound);
        setTimeout(() => setSearchError(null), 3000);
        return;
      }
      const data = await res.json();
      if (data.found && data.signal) {
        const existingIndex = pinnedStocks.findIndex(s => s.symbol === data.signal.symbol);
        if (existingIndex >= 0) {
          setSearchError(`${data.signal.symbol} is already pinned`);
          setTimeout(() => setSearchError(null), 3000);
        } else {
          setPinnedStocks(prev => [data.signal, ...prev]);
          setSearchQuery('');
        }
      }
    } catch (err) {
      console.error('Search failed:', err);
      setSearchError(t.symbolNotFound);
      setTimeout(() => setSearchError(null), 3000);
    } finally {
      setSearching(false);
    }
  };

  const removePinnedStock = (symbol: string) => {
    setPinnedStocks(prev => prev.filter(s => s.symbol !== symbol));
  };

  const toggleLanguage = () => setLang(lang === 'en' ? 'ar' : 'en');

  const applyPriceFilter = () => {
    setPriceFilterActive(true);
    // Fetch stocks with price filter from backend
    fetchStocksWithPriceFilterCallback();
  };

  const clearPriceFilter = () => {
    setMinPrice('');
    setMaxPrice('');
    setPriceFilterActive(false);
    // Fetch stocks without price filter
    fetchStocks(sortBy || undefined);
  };

  // When price filter is active, use backend-filtered stocks
  const displayStocks = [...pinnedStocks, ...stocks.filter(s => !pinnedStocks.find(p => p.symbol === s.symbol))].slice(0, 8);

  return (
    <div className="min-h-screen bg-zinc-950 text-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <LoadingProgressBar isLoading={loading || searching} />
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQcAQKTh7aJhAQBHqOLvnVwAAEqp4u+aWQAATKni75hXAABNquLvl1YAAEyq4u+XVgAAS6ri75dWAABKquLvl1YAAEmq4u+XVgAASKri75dWAABHquLvl1YAAEaq4u+XVgAARari75dWAABEq+LvmFYAAEOr4u+YVgAAQqvi75hWAABBq+LvmFYAAECr4u+YVgAAPqvi75lWAAA9q+LvmVYAADyr4u+ZVgAAO6vi75lWAAA6q+LvmVYAADmr4u+ZVgAAOKvi75lWAAA3q+LvmVYAADar4u+ZVgAANavi75lWAAA0q+LvmVYAADOr4u+ZVgAAMqvi75lWAAAxq+LvmVYAADCr4u+ZVgAAL6vi75lWAAAuq+LvmVYAAC2r4u+ZVgAALKvi75lWAAArq+LvmVYAACqr4u+ZVgAAKavi75lWAAAoq+LvmVYAACer4u+ZVgAAJqvi75lWAAAlq+LvmVYAACOr4u+ZVgAAIqvi75lWAAAhq+LvmVYAACCr4u+ZVgAAH6vi75lWAAAeq+LvmVYAAB2r4u+ZVgAAHKvi75lWAAAaq+LvmVYAABmr4u+ZVgAAGKvi75lWAAAXq+LvmVYAABar4u+ZVgAAFavi75lWAAAUq+LvmVYAABOr4u+ZVgAAEqvi75lWAAARq+LvmVYAABCr4u+ZVgAAD6vi75lWAAAOq+LvmVYAAA2r4u+ZVgAADKvi75lWAAALq+LvmVYAAAqr4u+ZVgAACavi75lWAAAIq+LvmVYAAAer4u+ZVgAABqvi75lWAAAFq+LvmVYAAASr4u+ZVgAAA6vi75lWAAACq+LvmVYAAAGr4u+ZVgAAAKvi75lWAAD/quLvmVYAAP6q4u+ZVgAA/ari75lWAAD8quLvmVYAAPuq4u+ZVgAA+qri75lWAAD5quLvmVYAAPiq4u+ZVgAA96ri75lWAAD2quLvmVYAAPWq4u+ZVgAA9Kri75lWAADzquLvmVYAAPKq4u+ZVgAA8ari75lWAADwquLvmVYAAO+q4u+ZVgAA7qri75lWAADtquLvmVYAAOyq4u+ZVgAA66ri75lWAADqquLvmVYAAOmq4u+ZVgAA6Kri75lWAADnquLvmVYAAOaq4u+ZVgAA5ari75lWAADkquLvmVYAAOOq4u+ZVgAA4qri75lWAADhquLvmVYAAOCq4u+ZVgAA36ri75lWAADeqeLvmVYAAN2p4u+ZVgAA3Kni75lWAADbqeLvmVYAANqp4u+ZVgAA2ani75lWAADYqeLvmVYAANep4u+ZVgAA1qni75lWAADVqeLvmVYAANSp4u+ZVgAA06ni75lWAADSqeLvmVYAANGp4u+ZVgAA0Kni75lWAADPqeLvmVYAAM6p4u+ZVgAAzani75lWAADMqeLvmVYAAMup4u+ZVgAAyqni75lWAADJqeLvmVYAAMip4u+ZVgAAx6ni75lWAADGqeLvmVYAAMWp4u+ZVgAAxKni75lWAADDqeLvmVYAAMKp4u+ZVgAAwani75lWAADAqeLvmVYAAL+p4u+ZVgAAvqni75lWAAC9qeLvmVYAALyp4u+ZVgAAu6ni75lWAAC6qeLvmVYAALmp4u+ZVgAAuKni75lWAAC3qeLvmVYAALap4u+ZVgAAtani75lWAAC0qeLvmVYAALOp4u+ZVgAAsqni75lWAACxqeLvmVYAALCp4u+ZVgAAr6ni75lWAACuqeLvmVYAAK2p4u+ZVgAArKni75lWAACrqeLvmVYAAKqp4u+ZVgAAqani75lWAACo" />
      <MarketStatusBar />
      <header className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex justify-between items-center gap-4">
            <div className="flex-shrink-0">
              <h1 className="text-2xl font-bold text-white">{t.title}</h1>
              <p className="text-zinc-500 text-sm">{t.subtitle}</p>
            </div>
            <form onSubmit={handleSearch} className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
                  placeholder={t.searchPlaceholder}
                  className="pl-10 pr-4 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 min-h-[44px]"
                  disabled={searching}
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-zinc-500 border-t-white rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              {searchError && (
                <p className="text-red-400 text-xs mt-1 absolute">{searchError}</p>
              )}
            </form>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="ghost" size="icon" onClick={toggleLanguage} className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px]" title={lang === 'en' ? 'العربية' : 'English'}>
                <Globe className="w-5 h-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px]"><Settings className="w-5 h-5" /></Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant={sortBy === 'price' ? 'default' : 'outline'} size="sm" onClick={() => handleSort('price')} className={`min-h-[44px] px-4 ${sortBy === 'price' ? 'bg-blue-600 text-white' : 'border-zinc-700 text-zinc-300'}`}><DollarSign className="w-4 h-4 mr-1" />{t.price}</Button>
            <Button variant={sortBy === 'profit' ? 'default' : 'outline'} size="sm" onClick={() => handleSort('profit')} className={`min-h-[44px] px-4 ${sortBy === 'profit' ? 'bg-blue-600 text-white' : 'border-zinc-700 text-zinc-300'}`}><Percent className="w-4 h-4 mr-1" />{t.potentialProfit}</Button>
            <Button variant={sortBy === 'short_term' ? 'default' : 'outline'} size="sm" onClick={() => handleSort('short_term')} className={`min-h-[44px] px-4 ${sortBy === 'short_term' ? 'bg-emerald-500 text-white' : 'border-zinc-700 text-zinc-300'}`}><Clock className="w-4 h-4 mr-1" />{t.shortTerm}</Button>
            <Button variant={sortBy === 'mid_term' ? 'default' : 'outline'} size="sm" onClick={() => handleSort('mid_term')} className={`min-h-[44px] px-4 ${sortBy === 'mid_term' ? 'bg-green-600 text-white' : 'border-zinc-700 text-zinc-300'}`}><Clock className="w-4 h-4 mr-1" />{t.midTerm}</Button>
            <Button variant={sortBy === 'long_term' ? 'default' : 'outline'} size="sm" onClick={() => handleSort('long_term')} className={`min-h-[44px] px-4 ${sortBy === 'long_term' ? 'bg-green-700 text-white' : 'border-zinc-700 text-zinc-300'}`}><Clock className="w-4 h-4 mr-1" />{t.longTerm}</Button>
          </div>
          {/* Price Filter - Separate Row for Better Visibility */}
          <div className="flex flex-wrap items-center gap-3 mt-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-purple-400" />
              <span className="text-zinc-300 font-medium">{t.priceFilter}:</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-zinc-400 text-sm">{t.minPrice}</label>
              <Input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0"
                className="w-24 h-9 bg-zinc-900 border-zinc-600 text-white text-center"
              />
              <span className="text-zinc-500">$</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-zinc-400 text-sm">{t.maxPrice}</label>
              <Input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="999"
                className="w-24 h-9 bg-zinc-900 border-zinc-600 text-white text-center"
              />
              <span className="text-zinc-500">$</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyPriceFilter} className="bg-purple-600 hover:bg-purple-700 px-4">{t.applyFilter}</Button>
              {priceFilterActive && (
                <Button size="sm" variant="outline" onClick={clearPriceFilter} className="border-zinc-600 text-zinc-300">{t.clearFilter}</Button>
              )}
            </div>
            {priceFilterActive && (
              <Badge className="bg-purple-600 text-white">
                {t.priceFilter}: ${minPrice || '0'} - ${maxPrice || '∞'}
              </Badge>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {apiError && (
          <div className="mb-4 p-4 bg-amber-900/50 border border-amber-700 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-amber-200 text-sm">{apiError}</p>
              {cacheAge !== null && (
                <p className="text-amber-400/70 text-xs mt-1">{t.cacheAge}: {Math.round(cacheAge)} {t.seconds}</p>
              )}
            </div>
          </div>
        )}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (<SkeletonCard key={i} />))}
          </div>
        ) : stocks.length === 0 && apiError ? (
          <div className="text-center py-12">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <p className="text-zinc-400 text-lg">{t.cooldownMessage}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {displayStocks.map(stock => {
                const isPinned = pinnedStocks.some(p => p.symbol === stock.symbol);
                return (
                  <div key={stock.symbol} className="relative">
                    {isPinned && (
                      <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removePinnedStock(stock.symbol);
                          }}
                          className="bg-amber-500 hover:bg-amber-600 text-black rounded-full p-1 shadow-lg"
                          title="Unpin"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="bg-amber-500 text-black text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                          <Pin className="w-3 h-3" />
                          {t.pinned}
                        </div>
                      </div>
                    )}
                    <StockCard 
                      stock={stock} 
                      onClick={() => setSelectedStock(stock.symbol)}
                      onAlertClick={(e) => {
                        e.stopPropagation();
                        setAlertStock(stock);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-6">
              <DemoPortfolio currentPrice={stocks[0]?.current_price || 191.08} />
            </div>
          </>
        )}
      </main>
      {selectedStock && <StockModal symbol={selectedStock} onClose={() => setSelectedStock(null)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {alertStock && <AlertModal stock={alertStock} onClose={() => setAlertStock(null)} onSave={() => fetchStocks(sortBy || undefined)} />}
    </div>
  );
}

function App() {
  const [lang, setLang] = useState<Language>('en');
  const t = translations[lang];

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      <AppContent />
    </LanguageContext.Provider>
  );
}

export default App
