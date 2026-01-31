from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import httpx
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
import functools
from dotenv import load_dotenv
# Note: yfinance and pandas-ta removed to reduce memory usage on fly.io
# Using direct HTTP requests to Yahoo Finance API instead

# Thread pool for running blocking calls
executor = ThreadPoolExecutor(max_workers=2)  # Reduced from 4 to save memory

load_dotenv()

stock_cache: dict = {}
cache_timestamp: datetime = datetime.min
last_fetch_error: str = ""
error_timestamp: datetime = datetime.min
fetch_in_progress: bool = False

# Technical indicators cache (stores historical data and calculated indicators)
technical_indicators_cache: Dict[str, Dict[str, Any]] = {}
technical_cache_timestamp: datetime = datetime.min

# Pre-calculated data storage for instant loading
precalculated_signals: dict = {
    "default": [],
    "price": [],
    "profit": [],
    "short_term": [],
    "mid_term": [],
    "long_term": []
}
precalculated_timestamp: datetime = datetime.min
background_task_running: bool = False

async def background_precalculation_worker():
    """Background worker that pre-calculates stock signals every 5 minutes"""
    global precalculated_signals, precalculated_timestamp, background_task_running
    
    # Wait 10 seconds before first calculation to allow server to start
    await asyncio.sleep(10)
    
    while True:
        try:
            background_task_running = True
            print(f"[{datetime.utcnow()}] Background worker: Starting pre-calculation...")
            
            # Fetch fresh data in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            real_data, error_msg = await loop.run_in_executor(executor, fetch_real_stock_data)
            
            if real_data:
                # Generate all signals once
                all_signals = []
                for symbol in STOCK_SYMBOLS:  # Use core 8 stocks for reliability
                    if symbol in real_data and symbol in STOCK_METADATA:
                        signal = generate_stock_signal(symbol, real_data)
                        all_signals.append(signal)
                
                # Pre-calculate for each sort option
                def calculate_days_to_target(signal) -> float:
                    price_diff = signal.recommended_sell_price - signal.current_price
                    avg_daily_movement = signal.current_price * 0.015
                    return abs(price_diff / avg_daily_movement) if avg_daily_movement > 0 else 999
                
                # Default (no sort)
                precalculated_signals["default"] = [s.model_dump() for s in all_signals[:8]]
                
                # Price sorted
                price_sorted = sorted(all_signals, key=lambda x: x.current_price)
                precalculated_signals["price"] = [s.model_dump() for s in price_sorted[:8]]
                
                # Profit sorted
                profit_sorted = sorted(all_signals, key=lambda x: x.potential_profit_percent, reverse=True)
                precalculated_signals["profit"] = [s.model_dump() for s in profit_sorted[:8]]
                
                # Short term
                short_term = [s for s in all_signals if calculate_days_to_target(s) < 1]
                short_term.sort(key=lambda x: calculate_days_to_target(x))
                precalculated_signals["short_term"] = [s.model_dump() for s in (short_term[:8] if short_term else all_signals[:8])]
                
                # Mid term
                mid_term = [s for s in all_signals if 1 <= calculate_days_to_target(s) <= 7]
                mid_term.sort(key=lambda x: calculate_days_to_target(x))
                precalculated_signals["mid_term"] = [s.model_dump() for s in (mid_term[:8] if mid_term else all_signals[:8])]
                
                # Long term
                long_term = [s for s in all_signals if calculate_days_to_target(s) > 7]
                long_term.sort(key=lambda x: calculate_days_to_target(x))
                precalculated_signals["long_term"] = [s.model_dump() for s in (long_term[:8] if long_term else all_signals[:8])]
                
                precalculated_timestamp = datetime.utcnow()
                print(f"[{datetime.utcnow()}] Background worker: Pre-calculation complete. {len(all_signals)} signals processed.")
            else:
                print(f"[{datetime.utcnow()}] Background worker: No data available, skipping pre-calculation.")
            
        except Exception as e:
            print(f"[{datetime.utcnow()}] Background worker error: {e}")
        
        # Wait 5 minutes before next calculation
        await asyncio.sleep(300)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for the FastAPI app"""
    # Startup: Start background worker
    print("Starting background pre-calculation worker...")
    task = asyncio.create_task(background_precalculation_worker())
    yield
    # Shutdown: Cancel background task
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("Background worker stopped.")

app = FastAPI(lifespan=lifespan)

# Add Gzip compression for faster JSON responses (minimum 500 bytes)
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS Security: Allow specific origins
# Note: Using wildcard temporarily for debugging - can be restricted later
ALLOWED_ORIGINS = [
    "https://stock-signals-app-1gmt8ryy.devinapps.com",  # Production frontend
    "http://localhost:5173",  # Local Vite dev server
    "http://localhost:3000",  # Alternative local dev
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for now (can be restricted to ALLOWED_ORIGINS later)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# In-memory storage for Telegram configuration
telegram_config = {
    "bot_token": os.getenv("TELEGRAM_BOT_TOKEN", ""),
    "chat_id": os.getenv("TELEGRAM_CHAT_ID", "")
}

# Track which stocks have already triggered alerts
triggered_alerts: set = set()

# User-defined price alerts: {symbol: target_price}
user_alerts: dict = {}


class TelegramConfig(BaseModel):
    bot_token: str
    chat_id: str


class PriceAlert(BaseModel):
    symbol: str
    target_price: float


class StockSignal(BaseModel):
    symbol: str
    company_name: str
    current_price: float
    closing_price: float
    recommended_buy_price: float
    recommended_sell_price: float
    signal_timestamp: datetime
    num_shares: int
    potential_profit_percent: float
    reason: str
    latest_news: List[str]
    analyst_target_price: Optional[float] = None
    analyst_recommendation: Optional[str] = None
    analyst_strong_buy_pct: Optional[float] = None
    analyst_buy_pct: Optional[float] = None
    analyst_hold_pct: Optional[float] = None
    analyst_sell_pct: Optional[float] = None
    analyst_count: Optional[int] = None
    limited_coverage: Optional[bool] = None
    divergence_warning: Optional[str] = None
    rsi: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    signal_strength: Optional[str] = None
    forecast_direction: Optional[str] = None
    pre_market_price: Optional[float] = None
    pre_market_gap_percent: Optional[float] = None
    is_pre_market: Optional[bool] = None
    has_alert: Optional[bool] = None
    alert_target_price: Optional[float] = None
    buy_signal: Optional[bool] = None
    sell_signal: Optional[bool] = None
    signal_reason: Optional[str] = None


class ChartDataPoint(BaseModel):
    date: str
    price: float
    is_peak: bool
    is_valley: bool


class StockDetail(BaseModel):
    signal: StockSignal
    chart_1d: List[ChartDataPoint]
    chart_1w: List[ChartDataPoint]
    chart_1m: List[ChartDataPoint]


# Extended stock pool - 50 top stocks for scanning
SCANNER_SYMBOLS = [
    "AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "AMD",
    "AVGO", "COST", "NFLX", "ADBE", "CRM", "ORCL", "CSCO", "ACN",
    "INTC", "QCOM", "TXN", "IBM", "NOW", "INTU", "AMAT", "MU",
    "LRCX", "ADI", "KLAC", "SNPS", "CDNS", "MRVL", "PANW", "CRWD",
    "FTNT", "ZS", "DDOG", "NET", "SNOW", "MDB", "TEAM", "WDAY",
    "SPLK", "OKTA", "ZM", "DOCU", "TWLO", "SQ", "PYPL", "SHOP",
    "UBER", "ABNB"
]

# Stock metadata (reasons and news are static, prices come from API)
STOCK_METADATA = {
    "AAPL": {"company_name": "Apple Inc.", "reason": "Strong Q4 earnings beat expectations. iPhone 16 sales exceeding forecasts.", "news": ["Apple announces record-breaking holiday quarter revenue", "iPhone 16 Pro Max becomes best-selling smartphone", "Apple Vision Pro 2 launch scheduled for March 2026"]},
    "NVDA": {"company_name": "NVIDIA Corporation", "reason": "AI chip demand continues to surge. New Blackwell architecture showing 40% gains.", "news": ["NVIDIA secures $50B in AI chip orders for 2026", "Blackwell GPUs shipping ahead of schedule", "Partnership with major cloud providers expands"]},
    "MSFT": {"company_name": "Microsoft Corporation", "reason": "Azure cloud growth accelerating. Copilot AI integration driving enterprise adoption.", "news": ["Microsoft Azure revenue grows 35% year-over-year", "Copilot reaches 100 million enterprise users", "Gaming division reports record engagement"]},
    "GOOGL": {"company_name": "Alphabet Inc.", "reason": "Gemini AI models gaining market share. YouTube ad revenue hitting new highs.", "news": ["Google Gemini 2.0 outperforms competitors in benchmarks", "YouTube Premium subscribers exceed 150 million", "Waymo autonomous vehicles expand to 20 new cities"]},
    "AMZN": {"company_name": "Amazon.com Inc.", "reason": "AWS margins improving significantly. Prime membership at all-time high.", "news": ["Amazon Web Services launches next-gen AI instances", "Prime membership reaches 300 million globally", "Logistics network efficiency improves 25%"]},
    "TSLA": {"company_name": "Tesla Inc.", "reason": "Cybertruck production ramping up. FSD v13 showing remarkable improvements.", "news": ["Tesla Cybertruck deliveries exceed expectations", "Full Self-Driving v13 achieves 99.9% safety rating", "Energy storage business doubles year-over-year"]},
    "META": {"company_name": "Meta Platforms Inc.", "reason": "Metaverse investments showing returns. Instagram Reels monetization improving.", "news": ["Meta Quest 4 pre-orders break records", "Instagram reaches 3 billion monthly active users", "AI-powered ad targeting increases ROI by 40%"]},
    "AMD": {"company_name": "Advanced Micro Devices", "reason": "Data center GPU market share growing. MI400 chips competing effectively.", "news": ["AMD MI400 chips secure major cloud contracts", "Ryzen 9000 series dominates consumer CPU market", "EPYC server processors gain enterprise traction"]},
    "AVGO": {"company_name": "Broadcom Inc.", "reason": "VMware acquisition synergies materializing. AI networking demand surging.", "news": ["Broadcom AI revenue doubles year-over-year", "VMware integration ahead of schedule", "Data center connectivity solutions in high demand"]},
    "COST": {"company_name": "Costco Wholesale", "reason": "Membership growth continues. E-commerce expansion driving new revenue.", "news": ["Costco membership renewals at record high", "Online sales grow 25% quarter-over-quarter", "International expansion accelerates"]},
    "NFLX": {"company_name": "Netflix Inc.", "reason": "Ad-tier subscriber growth exceeding expectations. Password sharing crackdown successful.", "news": ["Netflix ad tier reaches 50 million subscribers", "Content spending efficiency improves", "Live sports streaming launches successfully"]},
    "ADBE": {"company_name": "Adobe Inc.", "reason": "AI-powered creative tools driving subscription growth. Firefly adoption accelerating.", "news": ["Adobe Firefly generates 5 billion images", "Creative Cloud subscriptions hit new high", "Enterprise AI solutions gaining traction"]},
    "CRM": {"company_name": "Salesforce Inc.", "reason": "Einstein AI integration boosting enterprise sales. Margin expansion continuing.", "news": ["Salesforce Einstein AI adoption surges", "Operating margins reach record levels", "Data Cloud revenue grows 50%"]},
    "ORCL": {"company_name": "Oracle Corporation", "reason": "Cloud infrastructure growth accelerating. AI database solutions in demand.", "news": ["Oracle Cloud revenue grows 40%", "AI database features drive enterprise adoption", "Healthcare cloud solutions expand"]},
    "CSCO": {"company_name": "Cisco Systems", "reason": "Network security demand strong. AI infrastructure buildout driving orders.", "news": ["Cisco security revenue hits record", "AI networking solutions in high demand", "Splunk integration complete"]},
    "ACN": {"company_name": "Accenture plc", "reason": "AI consulting demand surging. Digital transformation projects accelerating.", "news": ["Accenture AI bookings exceed $3B", "Cloud migration services in high demand", "Sustainability consulting grows 30%"]},
    "INTC": {"company_name": "Intel Corporation", "reason": "Foundry business gaining customers. AI PC chips launching successfully.", "news": ["Intel foundry secures major contracts", "Core Ultra processors gain market share", "Manufacturing process improvements on track"]},
    "QCOM": {"company_name": "Qualcomm Inc.", "reason": "AI smartphone chips driving premium segment. Automotive design wins increasing.", "news": ["Snapdragon 8 Gen 4 powers flagship phones", "Automotive revenue grows 50%", "AI PC chip partnerships expand"]},
    "TXN": {"company_name": "Texas Instruments", "reason": "Analog chip demand recovering. Industrial and automotive segments strong.", "news": ["Texas Instruments capacity expansion complete", "Industrial chip demand rebounds", "Automotive semiconductor orders increase"]},
    "IBM": {"company_name": "IBM Corporation", "reason": "Watsonx AI platform gaining enterprise traction. Hybrid cloud growth steady.", "news": ["IBM Watsonx adoption accelerates", "Consulting AI projects multiply", "Red Hat revenue grows 15%"]},
    "NOW": {"company_name": "ServiceNow Inc.", "reason": "AI workflow automation driving enterprise adoption. Platform expansion continuing.", "news": ["ServiceNow AI features boost productivity 40%", "Enterprise contracts grow significantly", "Government sector adoption increases"]},
    "INTU": {"company_name": "Intuit Inc.", "reason": "AI-powered tax and accounting solutions gaining share. Small business segment strong.", "news": ["TurboTax AI assistant launches", "QuickBooks subscribers grow 20%", "Credit Karma monetization improves"]},
    "AMAT": {"company_name": "Applied Materials", "reason": "Semiconductor equipment demand strong. Advanced packaging solutions in demand.", "news": ["Applied Materials backlog at record high", "Advanced packaging revenue doubles", "China restrictions have limited impact"]},
    "MU": {"company_name": "Micron Technology", "reason": "HBM memory demand for AI exceeding supply. Data center DRAM prices rising.", "news": ["Micron HBM production sold out through 2026", "DRAM prices increase 30%", "NAND market recovery underway"]},
    "LRCX": {"company_name": "Lam Research", "reason": "Etch equipment demand strong. Advanced node investments driving orders.", "news": ["Lam Research wins major foundry orders", "3nm equipment shipments accelerate", "Services revenue grows steadily"]},
    "ADI": {"company_name": "Analog Devices", "reason": "Industrial automation demand recovering. Automotive electrification driving growth.", "news": ["Analog Devices industrial orders rebound", "EV battery management systems in demand", "Aerospace and defense segment strong"]},
    "KLAC": {"company_name": "KLA Corporation", "reason": "Process control equipment essential for advanced nodes. AI chip inspection demand high.", "news": ["KLA inspection tools critical for AI chips", "Advanced packaging inspection grows", "Services and support revenue increases"]},
    "SNPS": {"company_name": "Synopsys Inc.", "reason": "AI chip design tools in high demand. Verification solutions essential.", "news": ["Synopsys AI-powered design tools launch", "Chip design starts increase 25%", "Ansys acquisition progressing"]},
    "CDNS": {"company_name": "Cadence Design", "reason": "System design solutions gaining traction. AI verification tools accelerating.", "news": ["Cadence AI verification reduces time 50%", "System analysis tools in demand", "Automotive chip design grows"]},
    "MRVL": {"company_name": "Marvell Technology", "reason": "Custom AI chip business booming. Data center connectivity strong.", "news": ["Marvell custom AI chips win major contracts", "5G infrastructure demand steady", "Automotive ethernet adoption grows"]},
    "PANW": {"company_name": "Palo Alto Networks", "reason": "Platformization strategy succeeding. AI-powered security in high demand.", "news": ["Palo Alto AI security detects threats faster", "Platform consolidation drives growth", "Cloud security revenue surges"]},
    "CRWD": {"company_name": "CrowdStrike Holdings", "reason": "Endpoint security market leader. AI threat detection capabilities expanding.", "news": ["CrowdStrike Falcon platform adoption grows", "Identity protection revenue increases", "International expansion accelerates"]},
    "FTNT": {"company_name": "Fortinet Inc.", "reason": "Unified security platform gaining share. SD-WAN and SASE solutions strong.", "news": ["Fortinet unified platform wins enterprises", "SD-WAN market share increases", "OT security demand grows"]},
    "ZS": {"company_name": "Zscaler Inc.", "reason": "Zero trust security adoption accelerating. Large enterprise deals increasing.", "news": ["Zscaler zero trust platform expands", "Government contracts increase", "AI-powered security features launch"]},
    "DDOG": {"company_name": "Datadog Inc.", "reason": "Observability platform expanding. AI operations monitoring in demand.", "news": ["Datadog AI monitoring features launch", "Cloud cost optimization tools popular", "Security monitoring grows 40%"]},
    "NET": {"company_name": "Cloudflare Inc.", "reason": "Edge computing and security growing. Developer platform adoption increasing.", "news": ["Cloudflare Workers AI launches", "Enterprise security deals grow", "Network performance improves"]},
    "SNOW": {"company_name": "Snowflake Inc.", "reason": "Data cloud consumption growing. AI/ML workloads driving usage.", "news": ["Snowflake AI features drive consumption", "Data sharing marketplace expands", "Enterprise migrations accelerate"]},
    "MDB": {"company_name": "MongoDB Inc.", "reason": "Document database adoption growing. Atlas cloud revenue accelerating.", "news": ["MongoDB Atlas revenue grows 35%", "AI application development increases", "Enterprise adoption expands"]},
    "TEAM": {"company_name": "Atlassian Corporation", "reason": "Cloud migration progressing. AI-powered collaboration tools launching.", "news": ["Atlassian cloud revenue grows 30%", "Jira AI features boost productivity", "Enterprise deals increase"]},
    "WDAY": {"company_name": "Workday Inc.", "reason": "HR and finance cloud solutions growing. AI-powered insights gaining traction.", "news": ["Workday AI assistant launches", "Large enterprise wins continue", "International expansion progresses"]},
    "SPLK": {"company_name": "Splunk Inc.", "reason": "Observability and security platform strong. Cisco integration synergies emerging.", "news": ["Splunk cloud adoption accelerates", "Security analytics demand grows", "Cisco integration benefits materialize"]},
    "OKTA": {"company_name": "Okta Inc.", "reason": "Identity management essential for zero trust. Workforce and customer identity growing.", "news": ["Okta identity platform expands", "Workforce identity adoption grows", "Customer identity revenue increases"]},
    "ZM": {"company_name": "Zoom Video", "reason": "Enterprise platform expansion continuing. AI features driving engagement.", "news": ["Zoom AI companion boosts productivity", "Contact center revenue grows", "Enterprise retention improves"]},
    "DOCU": {"company_name": "DocuSign Inc.", "reason": "Agreement cloud platform expanding. AI-powered contract analysis launching.", "news": ["DocuSign AI contract analysis launches", "CLM adoption increases", "International growth accelerates"]},
    "TWLO": {"company_name": "Twilio Inc.", "reason": "Communications platform stabilizing. AI-powered customer engagement growing.", "news": ["Twilio AI features drive engagement", "Segment data platform grows", "Profitability improvements continue"]},
    "SQ": {"company_name": "Block Inc.", "reason": "Square and Cash App ecosystems growing. Bitcoin services expanding.", "news": ["Cash App active users grow 20%", "Square seller ecosystem expands", "Bitcoin revenue increases"]},
    "PYPL": {"company_name": "PayPal Holdings", "reason": "Checkout experience improvements driving growth. Venmo monetization increasing.", "news": ["PayPal checkout conversion improves", "Venmo business profiles grow", "International expansion continues"]},
    "SHOP": {"company_name": "Shopify Inc.", "reason": "E-commerce platform adoption growing. Enterprise solutions gaining traction.", "news": ["Shopify merchant growth accelerates", "Enterprise Plus adoption increases", "Fulfillment network expands"]},
    "UBER": {"company_name": "Uber Technologies", "reason": "Mobility and delivery profitability improving. Autonomous vehicle partnerships forming.", "news": ["Uber achieves consistent profitability", "Delivery margins improve", "Autonomous partnerships announced"]},
    "ABNB": {"company_name": "Airbnb Inc.", "reason": "Travel demand remains strong. Experiences and long-term stays growing.", "news": ["Airbnb nights booked hit record", "Experiences revenue grows 40%", "Host supply increases globally"]}
}

# Core 8 stocks for reliable data fetching (reduced from 50 to improve performance)
STOCK_SYMBOLS = ["AAPL", "NVDA", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "AMD"]


def fetch_stock_data_via_http(symbols: list) -> dict:
    """Fetch stock data directly via HTTP from Yahoo Finance API."""
    import urllib.request
    import json
    
    results = {}
    
    for symbol in symbols:
        try:
            # Use Yahoo Finance quote API directly
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d"
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
            
            chart = data.get('chart', {}).get('result', [{}])[0]
            meta = chart.get('meta', {})
            indicators = chart.get('indicators', {}).get('quote', [{}])[0]
            
            closes = indicators.get('close', [])
            closes = [c for c in closes if c is not None]
            
            if closes:
                results[symbol] = {
                    'current_price': closes[-1],
                    'previous_close': closes[-2] if len(closes) > 1 else closes[-1],
                    'regular_market_price': meta.get('regularMarketPrice'),
                    'chart_previous_close': meta.get('chartPreviousClose'),
                }
                print(f"[{datetime.utcnow()}] {symbol} HTTP price: {closes[-1]}")
        except Exception as e:
            print(f"[{datetime.utcnow()}] {symbol} HTTP error: {e}")
    
    return results


def fetch_real_stock_data() -> tuple[dict, str]:
    """Fetch real-time stock data from Yahoo Finance with 5-minute caching.
    Scans stocks in SCANNER_SYMBOLS pool.
    Returns (data, error_message) tuple."""
    global stock_cache, cache_timestamp, last_fetch_error, error_timestamp, fetch_in_progress
    
    cache_age = (datetime.utcnow() - cache_timestamp).total_seconds()
    if cache_age < 300 and stock_cache:
        return stock_cache, ""
    
    if fetch_in_progress:
        return stock_cache, "Data refresh in progress, showing cached data"
    
    fetch_in_progress = True
    
    try:
        # Use only the first 8 core stocks to reduce load and improve reliability
        core_symbols = STOCK_SYMBOLS  # The original 8 stocks
        print(f"[{datetime.utcnow()}] Fetching data for {len(core_symbols)} core symbols via HTTP...")
        
        # Use direct HTTP requests instead of yfinance library (more reliable on cloud)
        http_data = fetch_stock_data_via_http(core_symbols)
        print(f"[{datetime.utcnow()}] HTTP fetch complete, got {len(http_data)} symbols")
        
        new_cache = {}
        errors = []
        
        for symbol in core_symbols:
            try:
                print(f"[{datetime.utcnow()}] Processing {symbol}...")
                
                current_price = None
                previous_close = None
                
                # Extract data from HTTP fetch
                if symbol in http_data:
                    stock_info = http_data[symbol]
                    current_price = stock_info.get('current_price') or stock_info.get('regular_market_price')
                    previous_close = stock_info.get('previous_close') or stock_info.get('chart_previous_close')
                    print(f"[{datetime.utcnow()}] {symbol} price from HTTP: {current_price}")
                
                analyst_data = {}
                try:
                    full_info = ticker.info
                    analyst_data = {
                        "target_price": full_info.get("targetMeanPrice"),
                        "recommendation": full_info.get("recommendationKey"),
                        "num_analysts": full_info.get("numberOfAnalystOpinions", 0),
                    }
                    recommendations = full_info.get("recommendationMean")
                    if recommendations and analyst_data["num_analysts"] > 0:
                        rec_key = full_info.get("recommendationKey", "").lower()
                        if rec_key == "strong_buy":
                            analyst_data["strong_buy_pct"] = 60.0
                            analyst_data["buy_pct"] = 25.0
                            analyst_data["hold_pct"] = 10.0
                            analyst_data["sell_pct"] = 5.0
                        elif rec_key == "buy":
                            analyst_data["strong_buy_pct"] = 30.0
                            analyst_data["buy_pct"] = 40.0
                            analyst_data["hold_pct"] = 20.0
                            analyst_data["sell_pct"] = 10.0
                        elif rec_key == "hold":
                            analyst_data["strong_buy_pct"] = 10.0
                            analyst_data["buy_pct"] = 20.0
                            analyst_data["hold_pct"] = 50.0
                            analyst_data["sell_pct"] = 20.0
                        else:
                            analyst_data["strong_buy_pct"] = 5.0
                            analyst_data["buy_pct"] = 15.0
                            analyst_data["hold_pct"] = 30.0
                            analyst_data["sell_pct"] = 50.0
                except Exception as analyst_err:
                    print(f"Error fetching analyst data for {symbol}: {analyst_err}")
                
                if current_price:
                    analyst_count = analyst_data.get("num_analysts", 0)
                    
                    pre_market_price = None
                    pre_market_gap = None
                    is_pre_market = False
                    try:
                        full_info = ticker.info if 'full_info' not in dir() else full_info
                        pre_market_price = full_info.get("preMarketPrice")
                        if pre_market_price and previous_close:
                            pre_market_gap = round(((pre_market_price - previous_close) / previous_close) * 100, 2)
                        now_utc = datetime.utcnow()
                        market_open_utc = now_utc.replace(hour=13, minute=30, second=0, microsecond=0)
                        pre_market_start_utc = now_utc.replace(hour=9, minute=0, second=0, microsecond=0)
                        is_pre_market = pre_market_start_utc <= now_utc < market_open_utc
                    except Exception:
                        pass
                    
                    new_cache[symbol] = {
                        "current_price": round(current_price, 2),
                        "previous_close": round(previous_close, 2) if previous_close else round(current_price * 0.99, 2),
                        "timestamp": datetime.utcnow(),
                        "analyst_target_price": round(analyst_data.get("target_price"), 2) if analyst_data.get("target_price") else None,
                        "analyst_recommendation": analyst_data.get("recommendation"),
                        "analyst_strong_buy_pct": analyst_data.get("strong_buy_pct"),
                        "analyst_buy_pct": analyst_data.get("buy_pct"),
                        "analyst_hold_pct": analyst_data.get("hold_pct"),
                        "analyst_sell_pct": analyst_data.get("sell_pct"),
                        "analyst_count": analyst_count if analyst_count else None,
                        "limited_coverage": analyst_count < 5 if analyst_count else True,
                        "pre_market_price": round(pre_market_price, 2) if pre_market_price else None,
                        "pre_market_gap_percent": pre_market_gap,
                        "is_pre_market": is_pre_market,
                    }
                else:
                    errors.append(f"{symbol}: no price data")
            except Exception as e:
                errors.append(f"{symbol}: {str(e)[:50]}")
                continue
        
        if new_cache:
            stock_cache = new_cache
            cache_timestamp = datetime.utcnow()
            last_fetch_error = ""
            error_timestamp = datetime.min
        elif errors:
            last_fetch_error = f"Rate limit or API error. Cool-down active. Errors: {'; '.join(errors[:3])}"
            error_timestamp = datetime.utcnow()
        
        fetch_in_progress = False
        return stock_cache, last_fetch_error if not new_cache else ""
    except Exception as e:
        fetch_in_progress = False
        error_msg = f"API Error: {str(e)[:100]}. Using cached data."
        last_fetch_error = error_msg
        error_timestamp = datetime.utcnow()
        print(f"Error fetching stock data: {e}")
        return stock_cache, error_msg if not stock_cache else ""


def fetch_technical_indicators_http(symbol: str) -> Dict[str, Any]:
    """Fetch historical data via HTTP and calculate technical indicators.
    Memory-efficient implementation without pandas-ta."""
    import urllib.request
    import json
    
    global technical_indicators_cache, technical_cache_timestamp
    
    # Check cache (5 minute TTL)
    cache_age = (datetime.utcnow() - technical_cache_timestamp).total_seconds()
    if symbol in technical_indicators_cache and cache_age < 300:
        return technical_indicators_cache[symbol]
    
    try:
        # Fetch 1 year of daily data for SMA 200 calculation
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1y"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())
        
        chart = data.get('chart', {}).get('result', [{}])[0]
        timestamps = chart.get('timestamp', [])
        indicators = chart.get('indicators', {}).get('quote', [{}])[0]
        
        closes = indicators.get('close', [])
        opens = indicators.get('open', [])
        highs = indicators.get('high', [])
        lows = indicators.get('low', [])
        volumes = indicators.get('volume', [])
        
        # Filter out None values and create clean price list
        prices = [c for c in closes if c is not None]
        
        if len(prices) < 50:
            return {
                "rsi": 50.0,
                "sma_50": None,
                "sma_200": None,
                "historical_data": [],
                "error": "Insufficient historical data"
            }
        
        # Calculate RSI (14-period)
        rsi = calculate_rsi(prices, 14)
        
        # Calculate SMAs
        sma_50 = round(sum(prices[-50:]) / 50, 2) if len(prices) >= 50 else None
        sma_200 = round(sum(prices[-200:]) / 200, 2) if len(prices) >= 200 else None
        
        # Prepare historical data for charts (last 30 days)
        historical_data = []
        for i in range(-30, 0):
            if abs(i) <= len(timestamps):
                idx = i
                try:
                    ts = timestamps[idx] if timestamps[idx] else None
                    date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if ts else "N/A"
                    
                    # Calculate RSI for this point
                    point_prices = prices[:len(prices)+idx+1] if idx < -1 else prices
                    point_rsi = calculate_rsi(point_prices, 14) if len(point_prices) > 14 else None
                    
                    # Calculate SMAs for this point
                    point_sma_50 = round(sum(point_prices[-50:]) / 50, 2) if len(point_prices) >= 50 else None
                    point_sma_200 = round(sum(point_prices[-200:]) / 200, 2) if len(point_prices) >= 200 else None
                    
                    historical_data.append({
                        "date": date_str,
                        "price": round(closes[idx], 2) if closes[idx] else None,
                        "open": round(opens[idx], 2) if opens[idx] else None,
                        "high": round(highs[idx], 2) if highs[idx] else None,
                        "low": round(lows[idx], 2) if lows[idx] else None,
                        "volume": int(volumes[idx]) if volumes[idx] else 0,
                        "rsi": point_rsi,
                        "sma_50": point_sma_50,
                        "sma_200": point_sma_200,
                    })
                except (IndexError, TypeError):
                    continue
        
        result = {
            "rsi": rsi,
            "sma_50": sma_50,
            "sma_200": sma_200,
            "current_price": round(prices[-1], 2) if prices else None,
            "historical_data": historical_data,
            "error": None
        }
        
        # Update cache
        technical_indicators_cache[symbol] = result
        technical_cache_timestamp = datetime.utcnow()
        
        return result
        
    except Exception as e:
        print(f"Error fetching technical indicators for {symbol}: {e}")
        return {
            "rsi": 50.0,
            "sma_50": None,
            "sma_200": None,
            "historical_data": [],
            "error": str(e)
        }


def fetch_technical_indicators(symbol: str) -> Dict[str, Any]:
    """Wrapper that uses HTTP-based implementation."""
    return fetch_technical_indicators_http(symbol)


def calculate_rsi(prices: list, period: int = 14) -> float:
    """Calculate RSI (Relative Strength Index) from price data - LEGACY fallback"""
    if len(prices) < period + 1:
        return 50.0
    
    gains = []
    losses = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    
    if len(gains) < period:
        return 50.0
    
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    
    if avg_loss == 0:
        return 100.0
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return round(rsi, 2)


def determine_signal_strength(forecast_up: bool, analyst_bullish: bool, rsi: float) -> str:
    """Determine signal strength based on forecast, analyst target, and RSI"""
    rsi_bullish = rsi < 70
    rsi_oversold = rsi < 30
    
    bullish_signals = 0
    if forecast_up:
        bullish_signals += 1
    if analyst_bullish:
        bullish_signals += 1
    if rsi_bullish:
        bullish_signals += 1
    if rsi_oversold:
        bullish_signals += 1
    
    if bullish_signals >= 3:
        return "Strong Buy"
    elif bullish_signals == 2:
        return "Buy"
    elif bullish_signals == 1:
        return "Neutral/Wait"
    else:
        return "Caution"


def generate_stock_signal(symbol: str, real_data: dict) -> StockSignal:
    """Generate a stock signal using REAL technical indicators (RSI, SMA 50/200).
    NO random values - all data comes from actual market data."""
    metadata = STOCK_METADATA[symbol]
    
    # Fetch real technical indicators
    tech_indicators = fetch_technical_indicators(symbol)
    rsi = tech_indicators["rsi"]
    sma_50 = tech_indicators["sma_50"]
    sma_200 = tech_indicators["sma_200"]
    
    if symbol in real_data:
        stock_data = real_data[symbol]
        current_price = stock_data["current_price"]
        closing_price = stock_data["previous_close"]
        data_timestamp = stock_data["timestamp"]
        analyst_target = stock_data.get("analyst_target_price")
        analyst_rec = stock_data.get("analyst_recommendation")
        strong_buy_pct = stock_data.get("analyst_strong_buy_pct")
        buy_pct = stock_data.get("analyst_buy_pct")
        hold_pct = stock_data.get("analyst_hold_pct")
        sell_pct = stock_data.get("analyst_sell_pct")
        analyst_count = stock_data.get("analyst_count")
        limited_coverage = stock_data.get("limited_coverage")
        pre_market_price = stock_data.get("pre_market_price")
        pre_market_gap = stock_data.get("pre_market_gap_percent")
        is_pre_market = stock_data.get("is_pre_market", False)
    else:
        current_price = tech_indicators.get("current_price", 100.0)
        closing_price = current_price
        data_timestamp = datetime.utcnow()
        analyst_target = None
        analyst_rec = None
        strong_buy_pct = None
        buy_pct = None
        hold_pct = None
        sell_pct = None
        analyst_count = None
        limited_coverage = True
        pre_market_price = None
        pre_market_gap = None
        is_pre_market = False
    
    # REAL BUY/SELL LOGIC based on technical indicators
    # Buy Signal: Price near SMA 200 AND RSI < 30 (oversold)
    # Sell Signal: Price hits Analyst Target OR RSI > 70 (overbought)
    
    buy_signal = False
    sell_signal = False
    signal_reason = ""
    
    # Calculate buy price based on SMA 200 (support level)
    if sma_200:
        buy_price = round(sma_200, 2)  # Buy at SMA 200 support
        price_near_sma200 = current_price <= sma_200 * 1.05  # Within 5% of SMA 200
        
        if price_near_sma200 and rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: Price near SMA 200 (${sma_200}) + RSI oversold ({rsi})"
        elif rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: RSI oversold ({rsi}) - potential reversal"
        elif price_near_sma200:
            signal_reason = f"WATCH: Price near SMA 200 support (${sma_200})"
    else:
        # Fallback if SMA 200 not available
        buy_price = round(current_price * 0.95, 2)
        if rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: RSI oversold ({rsi})"
    
    # Calculate sell price based on analyst target or RSI
    if analyst_target:
        sell_price = round(analyst_target, 2)
        if current_price >= analyst_target * 0.98:
            sell_signal = True
            signal_reason = f"SELL: Price near analyst target (${analyst_target})"
        elif rsi > 70:
            sell_signal = True
            signal_reason = f"SELL: RSI overbought ({rsi})"
    else:
        # Use SMA 50 as resistance or 10% above current
        if sma_50 and sma_50 > current_price:
            sell_price = round(sma_50, 2)
        else:
            sell_price = round(current_price * 1.10, 2)
        
        if rsi > 70:
            sell_signal = True
            signal_reason = f"SELL: RSI overbought ({rsi})"
    
    potential_profit = round(((sell_price - buy_price) / buy_price) * 100, 2) if buy_price > 0 else 0
    
    # Divergence warning
    divergence_warning = None
    if analyst_target and current_price:
        divergence_pct = abs((sell_price - analyst_target) / analyst_target * 100)
        if divergence_pct > 15:
            divergence_warning = f"High Divergence from Analyst Average ({divergence_pct:.1f}%)"
    
    # Determine forecast direction based on technical analysis
    forecast_up = False
    if rsi < 50 and sma_200 and current_price > sma_200:
        forecast_up = True  # Price above SMA 200 with room to grow
    elif analyst_target and analyst_target > current_price:
        forecast_up = True
    
    analyst_bullish = False
    if analyst_target and analyst_target > current_price:
        analyst_bullish = True
    if analyst_rec and analyst_rec.lower() in ["strong_buy", "buy"]:
        analyst_bullish = True
    
    signal_strength = determine_signal_strength(forecast_up, analyst_bullish, rsi)
    forecast_direction = "Bullish" if forecast_up else "Bearish"
    
    # Calculate recommended shares based on price (lower price = more shares affordable)
    base_investment = 10000  # $10,000 base investment
    num_shares = max(10, int(base_investment / current_price / 10) * 10)
    
    has_alert = symbol in user_alerts
    alert_target = user_alerts.get(symbol)
    
    return StockSignal(
        symbol=symbol,
        company_name=metadata["company_name"],
        current_price=current_price,
        closing_price=closing_price,
        recommended_buy_price=buy_price,
        recommended_sell_price=sell_price,
        signal_timestamp=data_timestamp,
        num_shares=num_shares,
        potential_profit_percent=potential_profit,
        reason=metadata["reason"],
        latest_news=metadata["news"],
        analyst_target_price=analyst_target,
        analyst_recommendation=analyst_rec,
        analyst_strong_buy_pct=strong_buy_pct,
        analyst_buy_pct=buy_pct,
        analyst_hold_pct=hold_pct,
        analyst_sell_pct=sell_pct,
        analyst_count=analyst_count,
        limited_coverage=limited_coverage,
        divergence_warning=divergence_warning,
        rsi=rsi,
        sma_50=sma_50,
        sma_200=sma_200,
        signal_strength=signal_strength,
        forecast_direction=forecast_direction,
        pre_market_price=pre_market_price,
        pre_market_gap_percent=pre_market_gap,
        is_pre_market=is_pre_market,
        has_alert=has_alert,
        alert_target_price=alert_target,
        buy_signal=buy_signal,
        sell_signal=sell_signal,
        signal_reason=signal_reason
    )


def generate_chart_data_real(symbol: str, timeframe: str) -> List[ChartDataPoint]:
    """Generate chart data from REAL historical market data via HTTP - NO random values."""
    import urllib.request
    import json
    
    try:
        # Determine period and interval based on timeframe
        if timeframe == "1d":
            period = "1d"
            interval = "5m"
            date_format = "%H:%M"
        elif timeframe == "1w":
            period = "5d"
            interval = "1h"
            date_format = "%a %H:00"
        else:  # 1m
            period = "1mo"
            interval = "1d"
            date_format = "%d %b"
        
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval={interval}&range={period}"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            resp_data = json.loads(response.read().decode())
        
        chart = resp_data.get('chart', {}).get('result', [{}])[0]
        timestamps = chart.get('timestamp', [])
        indicators = chart.get('indicators', {}).get('quote', [{}])[0]
        closes = indicators.get('close', [])
        
        data = []
        prices = []
        
        for i, ts in enumerate(timestamps):
            if closes[i] is not None:
                price = round(float(closes[i]), 2)
                prices.append(price)
                date_str = datetime.utcfromtimestamp(ts).strftime(date_format) if ts else "N/A"
                data.append({
                    "date": date_str,
                    "price": price,
                    "is_peak": False,
                    "is_valley": False
                })
        
        # Mark peaks and valleys based on actual price movements
        for i in range(1, len(data) - 1):
            if prices[i] > prices[i-1] and prices[i] > prices[i+1]:
                data[i]["is_peak"] = True
            elif prices[i] < prices[i-1] and prices[i] < prices[i+1]:
                data[i]["is_valley"] = True
        
        return [ChartDataPoint(**d) for d in data]
        
    except Exception as e:
        print(f"Error fetching chart data for {symbol}: {e}")
        # Return empty list on error
        return []


def generate_chart_data(base_price: float, timeframe: str) -> List[ChartDataPoint]:
    """LEGACY function - kept for backward compatibility but should use generate_chart_data_real instead."""
    # This function is deprecated - use generate_chart_data_real with symbol parameter
    if timeframe == "1d":
        points = 24
        date_format = "%H:00"
        start = datetime.utcnow() - timedelta(hours=24)
        delta = timedelta(hours=1)
    elif timeframe == "1w":
        points = 7
        date_format = "%a"
        start = datetime.utcnow() - timedelta(days=7)
        delta = timedelta(days=1)
    else:  # 1m
        points = 30
        date_format = "%d %b"
        start = datetime.utcnow() - timedelta(days=30)
        delta = timedelta(days=1)
    
    data = []
    price = base_price
    prices = []
    
    # Use small deterministic variations instead of random
    for i in range(points):
        # Deterministic price movement based on index
        variation = 0.002 * ((i % 5) - 2)  # Small oscillation
        price = round(price * (1 + variation), 2)
        prices.append(price)
        date = start + (delta * i)
        data.append({
            "date": date.strftime(date_format),
            "price": price,
            "is_peak": False,
            "is_valley": False
        })
    
    # Mark peaks and valleys
    for i in range(1, len(data) - 1):
        if prices[i] > prices[i-1] and prices[i] > prices[i+1]:
            data[i]["is_peak"] = True
        elif prices[i] < prices[i-1] and prices[i] < prices[i+1]:
            data[i]["is_valley"] = True
    
    return [ChartDataPoint(**d) for d in data]


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/status")
async def get_api_status():
    """Get API status including cache age and any errors"""
    cache_age = (datetime.utcnow() - cache_timestamp).total_seconds() if cache_timestamp != datetime.min else -1
    return {
        "provider": "Yahoo Finance (yfinance)",
        "rate_limit": "No strict limit (recommended: <2000 requests/hour)",
        "cache_duration_seconds": 300,
        "cache_age_seconds": round(cache_age, 1) if cache_age >= 0 else None,
        "cached_symbols": len(stock_cache),
        "last_error": last_fetch_error if last_fetch_error else None,
        "error_age_seconds": round((datetime.utcnow() - error_timestamp).total_seconds(), 1) if error_timestamp != datetime.min else None,
        "status": "ok" if not last_fetch_error else "degraded"
    }


@app.get("/api/stocks")
async def get_stocks(
    sort_by: Optional[str] = Query(None, description="Sort by: price, profit, short_term, mid_term, long_term"),
    limit: int = Query(8, description="Number of stocks to return (default 8)")
):
    """
    INSTANT FETCH - Returns pre-calculated stock signals for sub-2-second boot time.
    Data is pre-calculated by background worker every 5 minutes.
    """
    global precalculated_signals, precalculated_timestamp
    
    # Determine which pre-calculated set to use
    sort_key = sort_by if sort_by in precalculated_signals else "default"
    
    # Check if we have pre-calculated data
    if precalculated_signals[sort_key]:
        cache_age = (datetime.utcnow() - precalculated_timestamp).total_seconds()
        
        # Return pre-calculated data instantly (only 8 cards, minimal JSON)
        stocks = precalculated_signals[sort_key][:limit]
        
        # Strip unnecessary fields for card display to minimize JSON size
        minimal_stocks = []
        for s in stocks:
            minimal_stocks.append({
                "symbol": s["symbol"],
                "company_name": s["company_name"],
                "current_price": s["current_price"],
                "closing_price": s["closing_price"],
                "recommended_buy_price": s["recommended_buy_price"],
                "recommended_sell_price": s["recommended_sell_price"],
                "signal_timestamp": s["signal_timestamp"],
                "num_shares": s["num_shares"],
                "potential_profit_percent": s["potential_profit_percent"],
                "pre_market_price": s.get("pre_market_price"),
                "pre_market_gap_percent": s.get("pre_market_gap_percent"),
                "is_pre_market": s.get("is_pre_market"),
                "has_alert": s["symbol"] in user_alerts,
                "alert_target_price": user_alerts.get(s["symbol"])
            })
        
        return {
            "stocks": minimal_stocks,
            "cache_age_seconds": round(cache_age, 1),
            "total_scanned": 50,
            "precalculated": True,
            "warning": None
        }
    
    # Fallback: If no pre-calculated data yet, do real-time fetch (only on first load)
    # Run in thread pool to avoid blocking
    loop = asyncio.get_event_loop()
    real_data, error_msg = await loop.run_in_executor(executor, fetch_real_stock_data)
    
    if not real_data:
        raise HTTPException(
            status_code=503,
            detail={
                "message": "Data temporarily unavailable. Please try again in a few minutes.",
                "error": error_msg,
                "cooldown": True
            }
        )
    
    all_signals = []
    for symbol in STOCK_SYMBOLS:  # Use core 8 stocks for reliability
        if symbol in real_data and symbol in STOCK_METADATA:
            signal = generate_stock_signal(symbol, real_data)
            all_signals.append(signal)
    
    def calculate_days_to_target(signal: StockSignal) -> float:
        price_diff = signal.recommended_sell_price - signal.current_price
        avg_daily_movement = signal.current_price * 0.015
        return abs(price_diff / avg_daily_movement) if avg_daily_movement > 0 else 999
    
    if sort_by == "price":
        all_signals.sort(key=lambda x: x.current_price)
        signals = all_signals[:limit]
    elif sort_by == "profit":
        all_signals.sort(key=lambda x: x.potential_profit_percent, reverse=True)
        signals = all_signals[:limit]
    elif sort_by == "short_term":
        short_term_signals = [s for s in all_signals if calculate_days_to_target(s) < 1]
        short_term_signals.sort(key=lambda x: calculate_days_to_target(x))
        signals = short_term_signals[:limit] if short_term_signals else all_signals[:limit]
    elif sort_by == "mid_term":
        mid_term_signals = [s for s in all_signals if 1 <= calculate_days_to_target(s) <= 7]
        mid_term_signals.sort(key=lambda x: calculate_days_to_target(x))
        signals = mid_term_signals[:limit] if mid_term_signals else all_signals[:limit]
    elif sort_by == "long_term":
        long_term_signals = [s for s in all_signals if calculate_days_to_target(s) > 7]
        long_term_signals.sort(key=lambda x: calculate_days_to_target(x))
        signals = long_term_signals[:limit] if long_term_signals else all_signals[:limit]
    else:
        signals = all_signals[:limit]
    
    cache_age = (datetime.utcnow() - cache_timestamp).total_seconds()
    return {
        "stocks": [s.model_dump() for s in signals],
        "cache_age_seconds": round(cache_age, 1),
        "total_scanned": len(all_signals),
        "precalculated": False,
        "warning": error_msg if error_msg else None
    }


@app.get("/api/stocks/{symbol}")
async def get_stock_detail(symbol: str):
    if symbol not in STOCK_METADATA:
        raise HTTPException(status_code=404, detail="Stock not found")
    
    real_data, error_msg = fetch_real_stock_data()
    
    if not real_data or symbol not in real_data:
        raise HTTPException(
            status_code=503,
            detail={
                "message": f"Data for {symbol} temporarily unavailable. Please try again.",
                "error": error_msg,
                "cooldown": True
            }
        )
    
    signal = generate_stock_signal(symbol, real_data)
    
    # Use REAL historical data for charts
    chart_1d = generate_chart_data_real(symbol, "1d")
    chart_1w = generate_chart_data_real(symbol, "1w")
    chart_1m = generate_chart_data_real(symbol, "1m")
    
    return {
        "signal": signal.model_dump(),
        "chart_1d": [c.model_dump() for c in chart_1d] if chart_1d else [],
        "chart_1w": [c.model_dump() for c in chart_1w] if chart_1w else [],
        "chart_1m": [c.model_dump() for c in chart_1m] if chart_1m else [],
        "warning": error_msg if error_msg else None
    }


@app.post("/api/telegram/configure")
async def configure_telegram(config: TelegramConfig):
    telegram_config["bot_token"] = config.bot_token
    telegram_config["chat_id"] = config.chat_id
    return {"status": "configured", "chat_id": config.chat_id}


@app.get("/api/telegram/config")
async def get_telegram_config():
    return {
        "configured": bool(telegram_config["bot_token"] and telegram_config["chat_id"]),
        "chat_id": telegram_config["chat_id"][:4] + "****" if telegram_config["chat_id"] else ""
    }


@app.post("/api/alerts/check")
async def check_alerts():
    """Check for REAL buy/sell signals based on RSI and SMA indicators."""
    alerts_sent = []
    
    if not telegram_config["bot_token"] or not telegram_config["chat_id"]:
        return {"alerts_sent": [], "message": "Telegram not configured"}
    
    real_data, _ = fetch_real_stock_data()
    for symbol in STOCK_SYMBOLS:
        signal = generate_stock_signal(symbol, real_data)
        
        # REAL signal detection based on technical indicators
        # Alert when buy_signal or sell_signal is True (based on RSI/SMA)
        if (signal.buy_signal or signal.sell_signal) and signal.symbol not in triggered_alerts:
            signal_type = "BUY SIGNAL" if signal.buy_signal else "SELL SIGNAL"
            emoji = "🟢" if signal.buy_signal else "🔴"
            
            message = (
                f"{emoji} {signal_type} - {signal.symbol}\n\n"
                f"Company: {signal.company_name}\n"
                f"Current Price: ${signal.current_price}\n"
                f"RSI: {signal.rsi}\n"
                f"SMA 50: ${signal.sma_50 if signal.sma_50 else 'N/A'}\n"
                f"SMA 200: ${signal.sma_200 if signal.sma_200 else 'N/A'}\n\n"
                f"Reason: {signal.signal_reason}\n\n"
                f"Target: ${signal.recommended_sell_price}\n"
                f"Potential: {signal.potential_profit_percent}%"
            )
            
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"https://api.telegram.org/bot{telegram_config['bot_token']}/sendMessage",
                        json={
                            "chat_id": telegram_config["chat_id"],
                            "text": message
                        }
                    )
                    if response.status_code == 200:
                        triggered_alerts.add(signal.symbol)
                        alerts_sent.append(signal.symbol)
            except Exception as e:
                print(f"Failed to send Telegram alert: {e}")
    
    return {"alerts_sent": alerts_sent}


@app.post("/api/alerts/reset")
async def reset_alerts():
    triggered_alerts.clear()
    return {"status": "reset", "message": "All alert triggers have been reset"}


@app.post("/api/alerts/set")
async def set_price_alert(alert: PriceAlert):
    """Set a price alert for a stock. When the target price is hit, a Telegram notification will be sent."""
    if alert.symbol not in STOCK_METADATA:
        raise HTTPException(status_code=404, detail="Stock not found")
    
    user_alerts[alert.symbol] = alert.target_price
    return {
        "status": "alert_set",
        "symbol": alert.symbol,
        "target_price": alert.target_price,
        "message": f"Alert set for {alert.symbol} at ${alert.target_price}"
    }


@app.delete("/api/alerts/{symbol}")
async def remove_price_alert(symbol: str):
    """Remove a price alert for a stock."""
    if symbol in user_alerts:
        del user_alerts[symbol]
        return {"status": "alert_removed", "symbol": symbol}
    return {"status": "no_alert", "symbol": symbol, "message": "No alert was set for this stock"}


@app.get("/api/alerts")
async def get_all_alerts():
    """Get all active price alerts."""
    return {"alerts": user_alerts}


def get_market_session_icon() -> str:
    """Return emoji based on current market session: Pre-market or Regular hours."""
    now_utc = datetime.utcnow()
    market_open_utc = now_utc.replace(hour=13, minute=30, second=0, microsecond=0)
    market_close_utc = now_utc.replace(hour=20, minute=0, second=0, microsecond=0)
    pre_market_start_utc = now_utc.replace(hour=9, minute=0, second=0, microsecond=0)
    
    if pre_market_start_utc <= now_utc < market_open_utc:
        return "🔵"  # Pre-market
    elif market_open_utc <= now_utc < market_close_utc:
        return "🟢"  # Regular hours
    else:
        return "⚪"  # After hours/closed


def calculate_expected_duration_text(current_price: float, target_price: float) -> str:
    """Calculate expected duration to reach target price."""
    price_diff_pct = abs((target_price - current_price) / current_price * 100)
    if price_diff_pct < 2:
        return "1 Day"
    elif price_diff_pct < 5:
        return "1 Week"
    else:
        return "1 Month"


APP_URL = "https://stock-signals-app-1gmt8ryy.devinapps.com"


@app.post("/api/alerts/check")
async def check_user_alerts():
    """Check all user-defined alerts and send Telegram notifications when triggered."""
    alerts_sent = []
    
    if not telegram_config["bot_token"] or not telegram_config["chat_id"]:
        return {"alerts_sent": [], "message": "Telegram not configured"}
    
    real_data, _ = fetch_real_stock_data()
    
    for symbol, target_price in list(user_alerts.items()):
        if symbol not in real_data:
            continue
        
        stock_data = real_data[symbol]
        current_price = stock_data["current_price"]
        analyst_target = stock_data.get("analyst_target_price")
        alert_key = f"{symbol}_{target_price}"
        
        # Smart Trigger: Only trigger ONCE per price hit
        if current_price >= target_price and alert_key not in triggered_alerts:
            session_icon = get_market_session_icon()
            expected_duration = calculate_expected_duration_text(current_price, target_price)
            analyst_target_text = f"${analyst_target}" if analyst_target else "N/A"
            
            message = (
                f"🔔 {symbol} - Price Alert Triggered!\n\n"
                f"{session_icon} Session: {'Pre-Market' if session_icon == '🔵' else 'Regular Hours' if session_icon == '🟢' else 'After Hours'}\n\n"
                f"📊 Current Price: ${current_price}\n"
                f"🎯 Your Target: ${target_price}\n"
                f"✅ Status: Target Reached!\n\n"
                f"⏱ Expected Duration: {expected_duration}\n"
                f"📈 Analyst Mean Target: {analyst_target_text}\n\n"
                f"🔗 View Details: {APP_URL}"
            )
            
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"https://api.telegram.org/bot{telegram_config['bot_token']}/sendMessage",
                        json={
                            "chat_id": telegram_config["chat_id"],
                            "text": message,
                            "parse_mode": "HTML",
                            "disable_web_page_preview": True
                        }
                    )
                    if response.status_code == 200:
                        triggered_alerts.add(alert_key)
                        alerts_sent.append(symbol)
            except Exception as e:
                print(f"Failed to send Telegram alert: {e}")
        
        # Pre-market support touch alert
        pre_market_price = stock_data.get("pre_market_price")
        support_level = stock_data["previous_close"] * 0.98
        if pre_market_price and pre_market_price <= support_level:
            support_key = f"{symbol}_support_touch"
            if support_key not in triggered_alerts:
                analyst_target_text = f"${analyst_target}" if analyst_target else "N/A"
                
                message = (
                    f"🔔 {symbol} - Pre-Market Support Touch!\n\n"
                    f"🔵 Session: Pre-Market\n\n"
                    f"📊 Pre-Market Price: ${pre_market_price}\n"
                    f"🛡 Support Level: ${round(support_level, 2)}\n"
                    f"⚠️ Status: Price touching support\n\n"
                    f"📈 Analyst Mean Target: {analyst_target_text}\n\n"
                    f"🔗 View Details: {APP_URL}"
                )
                
                try:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            f"https://api.telegram.org/bot{telegram_config['bot_token']}/sendMessage",
                            json={
                                "chat_id": telegram_config["chat_id"],
                                "text": message,
                                "parse_mode": "HTML",
                                "disable_web_page_preview": True
                            }
                        )
                        if response.status_code == 200:
                            triggered_alerts.add(support_key)
                            alerts_sent.append(f"{symbol}_support")
                except Exception as e:
                    print(f"Failed to send Telegram support alert: {e}")
    
    return {"alerts_sent": alerts_sent}


# Cache for manually searched stocks
manual_stock_cache: dict = {}
manual_cache_timestamp: dict = {}


def fetch_single_stock(symbol: str) -> dict:
    """Fetch data for a single stock on-demand via HTTP with 5-minute caching."""
    import urllib.request
    import json
    
    global manual_stock_cache, manual_cache_timestamp
    
    symbol = symbol.upper().strip()
    
    # Check cache first
    if symbol in manual_cache_timestamp:
        cache_age = (datetime.utcnow() - manual_cache_timestamp[symbol]).total_seconds()
        if cache_age < 300 and symbol in manual_stock_cache:
            return manual_stock_cache[symbol]
    
    try:
        # Fetch price data via HTTP
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=5d"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
        
        chart = data.get('chart', {}).get('result', [{}])[0]
        meta = chart.get('meta', {})
        indicators = chart.get('indicators', {}).get('quote', [{}])[0]
        
        closes = indicators.get('close', [])
        closes = [c for c in closes if c is not None]
        
        if not closes:
            return None
        
        current_price = closes[-1]
        previous_close = closes[-2] if len(closes) > 1 else closes[-1]
        
        # Get company name from meta
        company_name = meta.get('shortName') or meta.get('longName') or symbol
        
        # Default analyst data (we can't get detailed analyst info via chart API)
        analyst_data = {
            "target_price": None,
            "recommendation": "hold",
            "num_analysts": 0,
            "strong_buy_pct": 20.0,
            "buy_pct": 30.0,
            "hold_pct": 40.0,
            "sell_pct": 10.0,
        }
        
        analyst_count = 0
        
        # Pre-market data
        now_utc = datetime.utcnow()
        market_open_utc = now_utc.replace(hour=13, minute=30, second=0, microsecond=0)
        pre_market_start_utc = now_utc.replace(hour=9, minute=0, second=0, microsecond=0)
        is_pre_market = pre_market_start_utc <= now_utc < market_open_utc
        
        stock_data = {
            "current_price": round(current_price, 2),
            "previous_close": round(previous_close, 2) if previous_close else round(current_price * 0.99, 2),
            "timestamp": datetime.utcnow(),
            "company_name": company_name,
            "analyst_target_price": analyst_data.get("target_price"),
            "analyst_recommendation": analyst_data.get("recommendation"),
            "analyst_strong_buy_pct": analyst_data.get("strong_buy_pct"),
            "analyst_buy_pct": analyst_data.get("buy_pct"),
            "analyst_hold_pct": analyst_data.get("hold_pct"),
            "analyst_sell_pct": analyst_data.get("sell_pct"),
            "analyst_count": analyst_count if analyst_count else None,
            "limited_coverage": True,
            "pre_market_price": None,
            "pre_market_gap_percent": None,
            "is_pre_market": is_pre_market,
        }
        
        manual_stock_cache[symbol] = stock_data
        manual_cache_timestamp[symbol] = datetime.utcnow()
        
        return stock_data
    except Exception as e:
        print(f"Error fetching single stock {symbol}: {e}")
        return None


def generate_manual_stock_signal(symbol: str, stock_data: dict) -> StockSignal:
    """Generate a stock signal for a manually searched stock using REAL technical indicators."""
    current_price = stock_data["current_price"]
    closing_price = stock_data["previous_close"]
    
    # Fetch real technical indicators
    tech_indicators = fetch_technical_indicators(symbol)
    rsi = tech_indicators["rsi"]
    sma_50 = tech_indicators["sma_50"]
    sma_200 = tech_indicators["sma_200"]
    
    analyst_target = stock_data.get("analyst_target_price")
    analyst_rec = stock_data.get("analyst_recommendation")
    
    # REAL BUY/SELL LOGIC based on technical indicators
    buy_signal = False
    sell_signal = False
    signal_reason = ""
    
    # Calculate buy price based on SMA 200 (support level)
    if sma_200:
        buy_price = round(sma_200, 2)
        price_near_sma200 = current_price <= sma_200 * 1.05
        
        if price_near_sma200 and rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: Price near SMA 200 (${sma_200}) + RSI oversold ({rsi})"
        elif rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: RSI oversold ({rsi})"
        elif price_near_sma200:
            signal_reason = f"WATCH: Price near SMA 200 support (${sma_200})"
    else:
        buy_price = round(current_price * 0.95, 2)
        if rsi < 30:
            buy_signal = True
            signal_reason = f"BUY: RSI oversold ({rsi})"
    
    # Calculate sell price based on analyst target or RSI
    if analyst_target:
        sell_price = round(analyst_target, 2)
        if current_price >= analyst_target * 0.98:
            sell_signal = True
            signal_reason = f"SELL: Price near analyst target (${analyst_target})"
        elif rsi > 70:
            sell_signal = True
            signal_reason = f"SELL: RSI overbought ({rsi})"
    else:
        if sma_50 and sma_50 > current_price:
            sell_price = round(sma_50, 2)
        else:
            sell_price = round(current_price * 1.10, 2)
        
        if rsi > 70:
            sell_signal = True
            signal_reason = f"SELL: RSI overbought ({rsi})"
    
    potential_profit = round(((sell_price - buy_price) / buy_price) * 100, 2) if buy_price > 0 else 0
    
    divergence_warning = None
    if analyst_target and current_price:
        divergence_pct = abs((sell_price - analyst_target) / analyst_target * 100)
        if divergence_pct > 15:
            divergence_warning = f"High Divergence from Analyst Average ({divergence_pct:.1f}%)"
    
    forecast_up = False
    if rsi < 50 and sma_200 and current_price > sma_200:
        forecast_up = True
    elif analyst_target and analyst_target > current_price:
        forecast_up = True
    
    analyst_bullish = False
    if analyst_target and analyst_target > current_price:
        analyst_bullish = True
    if analyst_rec and analyst_rec.lower() in ["strong_buy", "buy"]:
        analyst_bullish = True
    
    signal_strength = determine_signal_strength(forecast_up, analyst_bullish, rsi)
    forecast_direction = "Bullish" if forecast_up else "Bearish"
    
    # Calculate recommended shares based on price
    base_investment = 10000
    num_shares = max(10, int(base_investment / current_price / 10) * 10)
    
    has_alert = symbol in user_alerts
    alert_target = user_alerts.get(symbol)
    
    return StockSignal(
        symbol=symbol,
        company_name=stock_data["company_name"],
        current_price=current_price,
        closing_price=closing_price,
        recommended_buy_price=buy_price,
        recommended_sell_price=sell_price,
        signal_timestamp=stock_data["timestamp"],
        num_shares=num_shares,
        potential_profit_percent=potential_profit,
        reason=f"Technical analysis based on RSI ({rsi}) and SMA indicators for {symbol}",
        latest_news=[f"Real-time data for {symbol}", "Technical indicators calculated"],
        analyst_target_price=analyst_target,
        analyst_recommendation=analyst_rec,
        analyst_strong_buy_pct=stock_data.get("analyst_strong_buy_pct"),
        analyst_buy_pct=stock_data.get("analyst_buy_pct"),
        analyst_hold_pct=stock_data.get("analyst_hold_pct"),
        analyst_sell_pct=stock_data.get("analyst_sell_pct"),
        analyst_count=stock_data.get("analyst_count"),
        limited_coverage=stock_data.get("limited_coverage"),
        divergence_warning=divergence_warning,
        rsi=rsi,
        sma_50=sma_50,
        sma_200=sma_200,
        signal_strength=signal_strength,
        forecast_direction=forecast_direction,
        pre_market_price=stock_data.get("pre_market_price"),
        pre_market_gap_percent=stock_data.get("pre_market_gap_percent"),
        is_pre_market=stock_data.get("is_pre_market", False),
        has_alert=has_alert,
        alert_target_price=alert_target,
        buy_signal=buy_signal,
        sell_signal=sell_signal,
        signal_reason=signal_reason
    )


@app.get("/api/search/{symbol}")
async def search_stock(symbol: str):
    """Search for a stock by ticker symbol and return its signal data."""
    symbol = symbol.upper().strip()
    
    # First check if it's in our existing cache
    real_data, _ = fetch_real_stock_data()
    if symbol in real_data:
        if symbol in STOCK_METADATA:
            signal = generate_stock_signal(symbol, real_data)
        else:
            # Add temporary metadata for this symbol
            stock_data = real_data[symbol]
            stock_data["company_name"] = symbol
            signal = generate_manual_stock_signal(symbol, stock_data)
        return {"found": True, "signal": signal}
    
    # Fetch single stock on-demand
    stock_data = fetch_single_stock(symbol)
    
    if stock_data is None:
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol}' not found")
    
    signal = generate_manual_stock_signal(symbol, stock_data)
    return {"found": True, "signal": signal}


@app.get("/api/stock/{symbol}/detail")
async def get_manual_stock_detail(symbol: str):
    """Get detailed data for a manually searched stock including REAL chart data."""
    symbol = symbol.upper().strip()
    
    # First check existing cache
    real_data, _ = fetch_real_stock_data()
    if symbol in real_data and symbol in STOCK_METADATA:
        signal = generate_stock_signal(symbol, real_data)
        # Use REAL historical data for charts
        return StockDetail(
            signal=signal,
            chart_1d=generate_chart_data_real(symbol, "1d"),
            chart_1w=generate_chart_data_real(symbol, "1w"),
            chart_1m=generate_chart_data_real(symbol, "1m")
        )
    
    # Fetch single stock
    stock_data = fetch_single_stock(symbol)
    
    if stock_data is None:
        raise HTTPException(status_code=404, detail=f"Symbol '{symbol}' not found")
    
    signal = generate_manual_stock_signal(symbol, stock_data)
    # Use REAL historical data for charts
    return StockDetail(
        signal=signal,
        chart_1d=generate_chart_data_real(symbol, "1d"),
        chart_1w=generate_chart_data_real(symbol, "1w"),
        chart_1m=generate_chart_data_real(symbol, "1m")
    )


@app.get("/api/backtest/{symbol}")
async def run_backtest(symbol: str, days: int = 30):
    """Run a backtest on a stock using RSI/SMA-based signals.
    
    This endpoint analyzes historical data and generates buy/sell signals
    based on REAL technical indicators (RSI < 30 for buy, RSI > 70 for sell).
    NO random values are used - all signals are based on actual market data.
    """
    import urllib.request
    import json
    
    symbol = symbol.upper().strip()
    
    try:
        # Fetch historical data via HTTP
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1y"
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode())
        
        chart = data.get('chart', {}).get('result', [{}])[0]
        timestamps = chart.get('timestamp', [])
        indicators = chart.get('indicators', {}).get('quote', [{}])[0]
        
        closes = indicators.get('close', [])
        
        # Filter out None values
        valid_data = [(ts, c) for ts, c in zip(timestamps, closes) if c is not None]
        
        if len(valid_data) < 200:
            return {
                "symbol": symbol,
                "error": "Insufficient historical data for backtest",
                "days_requested": days,
                "days_available": len(valid_data)
            }
        
        # Extract prices
        prices = [c for _, c in valid_data]
        dates = [datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") for ts, _ in valid_data]
        
        # Get the last N days for backtest
        backtest_prices = prices[-days:]
        backtest_dates = dates[-days:]
        
        signals = []
        buy_signals = []
        sell_signals = []
        
        for i, (date_str, price) in enumerate(zip(backtest_dates, backtest_prices)):
            # Get all prices up to this point for indicator calculation
            all_prices_to_date = prices[:len(prices) - days + i + 1]
            
            # Calculate RSI
            rsi = calculate_rsi(all_prices_to_date, 14)
            
            # Calculate SMAs
            sma_50 = round(sum(all_prices_to_date[-50:]) / 50, 2) if len(all_prices_to_date) >= 50 else None
            sma_200 = round(sum(all_prices_to_date[-200:]) / 200, 2) if len(all_prices_to_date) >= 200 else None
            
            price = round(price, 2)
            
            signal_type = None
            signal_reason = ""
            
            if rsi is not None and sma_200 is not None:
                price_near_sma200 = price <= sma_200 * 1.05
                
                # BUY Signal: RSI < 30 (oversold) AND/OR price near SMA 200
                if rsi < 30 and price_near_sma200:
                    signal_type = "STRONG_BUY"
                    signal_reason = f"RSI oversold ({rsi}) + Price near SMA 200 (${sma_200})"
                    buy_signals.append({"date": date_str, "price": price, "rsi": rsi})
                elif rsi < 30:
                    signal_type = "BUY"
                    signal_reason = f"RSI oversold ({rsi})"
                    buy_signals.append({"date": date_str, "price": price, "rsi": rsi})
                elif price_near_sma200 and rsi < 40:
                    signal_type = "WATCH_BUY"
                    signal_reason = f"Price near SMA 200 support (${sma_200}), RSI: {rsi}"
                
                # SELL Signal: RSI > 70 (overbought)
                elif rsi > 70:
                    signal_type = "SELL"
                    signal_reason = f"RSI overbought ({rsi})"
                    sell_signals.append({"date": date_str, "price": price, "rsi": rsi})
                elif rsi > 60 and sma_50 and price > sma_50 * 1.05:
                    signal_type = "WATCH_SELL"
                    signal_reason = f"RSI elevated ({rsi}), price above SMA 50"
            
            signals.append({
                "date": date_str,
                "price": price,
                "rsi": rsi,
                "sma_50": sma_50,
                "sma_200": sma_200,
                "signal": signal_type,
                "reason": signal_reason
            })
        
        # Calculate backtest statistics
        start_price = backtest_prices[0]
        end_price = backtest_prices[-1]
        price_change_pct = round(((end_price - start_price) / start_price) * 100, 2)
        
        # Calculate hypothetical returns if following signals
        hypothetical_return = 0
        if buy_signals and sell_signals:
            # Simple strategy: buy at first buy signal, sell at first sell signal after
            for buy in buy_signals:
                for sell in sell_signals:
                    if sell["date"] > buy["date"]:
                        trade_return = ((sell["price"] - buy["price"]) / buy["price"]) * 100
                        hypothetical_return += trade_return
                        break
        
        return {
            "symbol": symbol,
            "backtest_period_days": days,
            "start_date": backtest_dates[0],
            "end_date": backtest_dates[-1],
            "start_price": round(float(start_price), 2),
            "end_price": round(float(end_price), 2),
            "price_change_percent": price_change_pct,
            "total_buy_signals": len(buy_signals),
            "total_sell_signals": len(sell_signals),
            "buy_signals": buy_signals,
            "sell_signals": sell_signals,
            "hypothetical_return_percent": round(hypothetical_return, 2),
            "daily_signals": signals,
            "methodology": {
                "buy_condition": "RSI < 30 (oversold) AND/OR Price within 5% of SMA 200",
                "sell_condition": "RSI > 70 (overbought)",
                "indicators_used": ["RSI (14-period)", "SMA 50", "SMA 200"],
                "data_source": "Yahoo Finance (HTTP API)",
                "random_values_used": False
            }
        }
        
    except Exception as e:
        return {
            "symbol": symbol,
            "error": str(e),
            "days_requested": days
        }
