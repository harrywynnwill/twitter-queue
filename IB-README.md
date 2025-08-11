# Interactive Brokers Python API Server

A Python-based HTTP server that provides REST API access to Interactive Brokers market data using the `ib_insync` library for improved stability and async support.

## Features

- Historical market data retrieval
- Contract details lookup
- Health monitoring and connection status
- Automatic reconnection with random client IDs
- Configurable timeouts
- JSON REST API compatible with existing integrations
- Uses `ib_insync` library for improved stability and async support

## Prerequisites

1. **Interactive Brokers Account**: You need an IB account (paper trading or live)
2. **TWS or IB Gateway**: Install and run either:
   - Trader Workstation (TWS) - Full desktop application
   - IB Gateway - Lightweight headless application (recommended for servers)
3. **Python 3.7+**: Python interpreter installed on your system

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements-ib.txt
```

Or install manually:
```bash
pip install ib_insync flask requests nest-asyncio
```

### 2. Configure Interactive Brokers

#### Enable API Access in TWS/Gateway:
1. Open TWS or IB Gateway
2. Go to **Global Configuration** → **API** → **Settings**
3. Check **Enable ActiveX and Socket Clients**
4. Set **Socket port**: `7497` (paper trading) or `7496` (live trading)
5. Uncheck **Read-Only API** if you need to place orders (not implemented yet)
6. Add your server IP to **Trusted IPs** (use `127.0.0.1` for local development)
7. Click **OK** and restart TWS/Gateway

#### Default Ports:
- **Paper Trading**: 7497 (TWS), 4002 (Gateway)
- **Live Trading**: 7496 (TWS), 4001 (Gateway)

### 3. Environment Variables (Optional)

Create a `.env` file or set environment variables:

```bash
IB_HOST=127.0.0.1          # IB Gateway/TWS host
IB_PORT=7497               # IB Gateway/TWS port (7497=paper, 7496=live)
IB_CLIENT_ID=1             # Optional: specific client ID (auto-generated if not set)
IB_SERVER_PORT=3001        # HTTP server port
```

## Running the Server

### Development Mode

```bash
cd src/ib
python3 ib_server.py
```

### Production Mode

```bash
cd src/ib
python3 ib_server.py
```

The server will:
1. Start HTTP server on `http://localhost:3001`
2. Automatically connect to IB Gateway/TWS
3. Use random client ID to avoid conflicts
4. Log connection status and errors

### Expected Output

```
2024-01-15 10:30:00 - __main__ - INFO - 🚀 Starting IB HTTP server on http://localhost:3001
2024-01-15 10:30:00 - __main__ - INFO - 🔌 Expecting IB Gateway at 127.0.0.1:7497
2024-01-15 10:30:00 - __main__ - INFO - 🔄 Connecting to IB Gateway/TWS at 127.0.0.1:7497 (clientId=4523)...
2024-01-15 10:30:01 - ib_client - INFO - Successfully connected to IB
2024-01-15 10:30:01 - __main__ - INFO - ✅ Successfully connected to IB Gateway/TWS
```

## API Endpoints

### System Health

#### Check Connection Status
```bash
GET /ib/health
```

**Response:**
```json
{
  "status": "healthy",
  "connected": true,
  "host": "127.0.0.1",
  "port": 7497,
  "client_id": 4523,
  "ready": true,
  "timestamp": "2024-01-15T10:30:01.000Z"
}
```

#### Reconnect to IB
```bash
POST /ib/reconnect
```

### Market Data

#### Get Historical Data
```bash
GET /ib/market-data/AAPL
```

**Query Parameters:**
- `duration` (optional): Duration string, default `"1 D"`
  - Examples: `"1 D"`, `"1 W"`, `"1 M"`, `"1 Y"`
- `barSize` (optional): Bar size, default `"1 hour"`
  - Examples: `"1 min"`, `"5 mins"`, `"15 mins"`, `"1 hour"`, `"1 day"`
- `whatToShow` (optional): Data type, default `"TRADES"`
  - Options: `"TRADES"`, `"MIDPOINT"`, `"BID"`, `"ASK"`

**Example:**
```bash
GET /ib/market-data/AAPL?duration=1%20W&barSize=1%20day
```

**Response:**
```json
{
  "symbol": "AAPL",
  "duration": "1 W",
  "barSize": "1 day",
  "data": [
    {
      "time": "20240108",
      "open": 181.99,
      "high": 185.59,
      "low": 181.43,
      "close": 185.56,
      "volume": 54686300,
      "count": 645123,
      "wap": 184.31
    }
  ],
  "count": 5,
  "durationMs": 1250
}
```

### Contract Information

#### Get Contract Details
```bash
GET /ib/contract-details/AAPL
GET /ib/contract-details/EURBBL?code=EURBBL
```

**Query Parameters:**
- `code` (optional): Product code for predefined instruments
- `secType` (optional): Security type, default `"STK"`
- `exchange` (optional): Exchange, default `"SMART"`
- `currency` (optional): Currency, default `"USD"`

**Response:**
```json
{
  "symbol": "AAPL",
  "contracts": [
    {
      "symbol": "AAPL",
      "secType": "STK",
      "exchange": "NASDAQ",
      "currency": "USD",
      "localSymbol": "AAPL",
      "conId": 265598,
      "longName": "APPLE INC",
      "category": "Technology",
      "timeZoneId": "US/Eastern"
    }
  ],
  "count": 1
}
```

### Product Mappings

#### List Available Products
```bash
GET /ib/products
```

**Response:**
```json
{
  "products": {
    "UKGB": {
      "symbol": "G",
      "secType": "CONTFUT",
      "exchange": "LIFFE",
      "currency": "GBP"
    },
    "UST10Y": {
      "symbol": "ZN", 
      "secType": "CONTFUT",
      "exchange": "CBOT",
      "currency": "USD"
    },
    "EURBBL": {
      "symbol": "FGBL",
      "secType": "CONTFUT", 
      "exchange": "EUREX",
      "currency": "EUR"
    }
  },
  "count": 8
}
```

#### Available Product Codes

**UK Market (LIFFE):**
- `UKGB` - UK Long Gilt (Symbol: G, Currency: GBP)

**US Treasury Futures (CBOT):**
- `UST10Y` - 10-Year Treasury Note (Symbol: ZN, Currency: USD)  
- `UST05Y` - 5-Year Treasury Note (Symbol: ZF, Currency: USD)
- `UST30Y` - 30-Year Treasury Bond (Symbol: ZB, Currency: USD)

**European Bonds (EUREX):**
- `EURBBL` - German Bund (Symbol: FGBL, Currency: EUR)
- `EURSCA` - German Schatz 2-Year (Symbol: FGBS, Currency: EUR)
- `ITB10Y` - Italian BTP 10-Year (Symbol: FBTP, Currency: EUR)
- `EURBND` - German Bobl 5-Year (Symbol: GBL, Currency: EUR)

#### Using Product Codes

You can use product codes directly in market data requests:

```bash
# Get German Bund data
GET /ib/market-data/EURBBL?duration=1%20W&barSize=1%20day

# Get German Bund March 2025 contract
GET /ib/market-data/EURBBLM25?duration=1%20D&barSize=1%20hour

# Get US 10-Year Treasury data  
GET /ib/market-data/UST10Y?duration=1%20M&barSize=1%20day
```

## Testing the API

### Using curl

```bash
# Check health
curl http://localhost:3001/ib/health

# List available products
curl http://localhost:3001/ib/products

# Get AAPL daily data for 1 week
curl "http://localhost:3001/ib/market-data/AAPL?duration=1%20W&barSize=1%20day"

# Get German Bund daily data for 1 month using product code
curl "http://localhost:3001/ib/market-data/EURBBL?duration=1%20M&barSize=1%20day"

# Get contract details
curl http://localhost:3001/ib/contract-details/AAPL

# Get contract details for German Bund using product code
curl "http://localhost:3001/ib/contract-details/EURBBL?code=EURBBL"

# Reconnect (if needed)
curl -X POST http://localhost:3001/ib/reconnect
```

### Using Python requests

```python
import requests

# Check health
response = requests.get('http://localhost:3001/ib/health')
print(response.json())

# Get market data
response = requests.get('http://localhost:3001/ib/market-data/AAPL', 
                       params={'duration': '1 W', 'barSize': '1 day'})
data = response.json()
print(f"Got {data['count']} bars for {data['symbol']}")
```

## Troubleshooting

### Common Issues

#### 1. Connection Failed
```
⚠️ Initial IB connect failed: Connection error
```

**Solutions:**
- Ensure TWS/Gateway is running
- Check API settings are enabled in TWS/Gateway
- Verify correct host/port in environment variables
- Check firewall settings

#### 2. Client ID Conflicts
```
Error 326: Unable to connect as the client id is already in use
```

**Solutions:**
- The server automatically uses random client IDs
- If issue persists, restart TWS/Gateway
- Use `/ib/reconnect` endpoint to get new client ID

#### 3. No Market Data
```
Error 354: Requested market data is not subscribed
```

**Solutions:**
- Ensure you have market data subscriptions in your IB account
- For paper trading, most US stock data should be available
- Check if the symbol exists and is correctly formatted

#### 4. Connection Timeout
```
Failed to connect to IB within 15s timeout
```

**Solutions:**
- Increase timeout in `ib_server.py` (line 245: `timeout=15`)
- Check network connection to IB servers
- Restart TWS/Gateway

### Logs and Debugging

The server provides detailed JSON-formatted logs:
- Connection events
- API request/response timing
- Error messages with context
- Client ID assignments

Enable debug logging by modifying `ib_client.py`:
```python
logging.basicConfig(level=logging.DEBUG)
```

### Port Conflicts

If port 3001 is in use, set a different port:
```bash
export IB_SERVER_PORT=3002
python3 ib_server.py
```

## Integration with Existing Code

This Python server provides the same REST API endpoints as the TypeScript version, so existing integrations should work without changes:

```javascript
// Existing TypeScript/JavaScript code works unchanged
const response = await fetch('http://localhost:3001/ib/market-data/AAPL');
const data = await response.json();
```

## Performance Notes

- Initial connection: ~1-3 seconds
- Market data requests: ~500ms - 2s depending on data range
- Contract details: ~200-500ms
- The server maintains persistent connection to IB for better performance
- Random client IDs prevent conflicts in multi-instance deployments

## Security

- The server runs on localhost by default
- No authentication is implemented - secure your network accordingly
- IB API credentials are managed by TWS/Gateway, not this server
- Consider running behind reverse proxy for production use