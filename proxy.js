const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Cache storage for quotes
const quoteCache = {
  data: {},
  lastUpdated: 0
};

// Security: Add basic security headers
app.use(helmet());

// Security: Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later'
});
app.use('/api/', limiter);

// Security: Restrict CORS to approved origins
app.use((req, res, next) => {
  // In production, replace with your actual domain
  const allowedOrigins = [
    'https://hw-invest.web.app',
    'https://hw-invest.firebaseapp.com'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
  next();
});


// Function to fetch data from Finnhub
async function fetchStockData(symbol) {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const response = await axios.get(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`
    );
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error.message);
    return null;
  }
}

// List of stocks to monitor - these should be the tickers your app uses
const MONITORED_STOCKS = [
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 
  'TSLA', 'NVDA', 'JPM', 'JNJ', 'V',
  'WMT', 'KO', 'PG', 'NFLX', 'DIS',
  'PFE', 'INTC', 'MA', 'UNH', 'VZ',
  'AMD', 'PYPL', 'ADBE', 'CRM', 'BA',
  'GE', 'SBUX', 'MCD', 'ABNB', 'UBER',
  'COST', 'TGT', 'F', 'NKE', 'T'
];

// Update all stocks data (runs every 3 minutes)
async function updateAllStocks() {
  console.log('Updating stock data from Finnhub...');
  
  // Add delay between API calls to avoid hitting rate limits
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  for (const symbol of MONITORED_STOCKS) {
    try {
      const data = await fetchStockData(symbol);
      if (data) {
        quoteCache.data[symbol] = {
          data: data,
          timestamp: Date.now()
        };
        console.log(`Updated ${symbol}: $${data.c}`);
      }
      // Wait 1.5 seconds between API calls to respect Finnhub's rate limit
      await delay(1500);
    } catch (err) {
      console.error(`Failed to update ${symbol}:`, err);
    }
  }
  
  quoteCache.lastUpdated = Date.now();
  console.log('Stock update completed at:', new Date().toLocaleTimeString());
}

// Endpoint to get cached quote data for a specific stock
app.get('/api/quote', async (req, res) => {
  const symbol = req.query.symbol;
  
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol parameter is required' });
  }
  
  // Check if we have cached data
  if (quoteCache.data[symbol] && 
      Date.now() - quoteCache.data[symbol].timestamp < 3 * 60 * 1000) {
    return res.json(quoteCache.data[symbol].data);
  }
  
  // If we have no cached data for this symbol or it's stale, fetch it
  try {
    const data = await fetchStockData(symbol);
    if (data) {
      quoteCache.data[symbol] = {
        data: data,
        timestamp: Date.now()
      };
      return res.json(data);
    } else {
      return res.status(404).json({ error: 'Symbol data not available' });
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// New endpoint to get all cached quotes at once
app.get('/api/quotes', (req, res) => {
  // Return all cached quotes with last updated timestamp
  const result = {
    lastUpdated: quoteCache.lastUpdated,
    data: {}
  };
  
  // Format the response to only include the actual quote data, not our metadata
  for (const symbol in quoteCache.data) {
    result.data[symbol] = quoteCache.data[symbol].data;
  }
  
  res.json(result);
});

// Get server status and cache information
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    lastUpdated: quoteCache.lastUpdated,
    stocksTracked: Object.keys(quoteCache.data).length,
    uptime: process.uptime()
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
  
  // Initial update
  updateAllStocks();
  
  // Schedule updates every 3 minutes
  setInterval(updateAllStocks, 3 * 60 * 1000);
}); 
