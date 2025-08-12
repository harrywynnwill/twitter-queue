# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Twitter queue system built with TypeScript that uses BullMQ for job queuing and Redis for message storage. It provides an Express.js REST API to queue tweets and a worker process to send them via the Twitter API.

## Key Commands

### Development (Local)
- `npm run dev` - Start the Twitter queue server in development mode with auto-reload
- `npm run worker` - Start the worker process to process queued tweets
- `./scripts/ib-server.sh` - Start the Interactive Brokers Python server
- `./scripts/ib-server-random.sh` - Start the IB server with random client IDs
- `python3 src/ib/ib_server.py` - Run the Python IB Web API server directly
- `ts-node src/server.ts` - Run the Twitter queue server directly 
- `ts-node src/worker.ts` - Run the worker directly

### Production
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start the compiled Twitter queue server
- `npm run start:worker` - Start the compiled worker

### Docker
- `docker-compose up` - Start all services (Redis, server, worker)
- `docker-compose up -d` - Start services in background
- `docker-compose down` - Stop all services
- `docker-compose logs` - View logs from all services
- `docker-compose logs app` - View server logs only
- `docker-compose logs worker` - View worker logs only

## Architecture

The system consists of four main components:

1. **Twitter Queue Server** (`src/server.ts`) - Express.js REST API for trade notifications with POST `/trade` endpoint that formats trades and adds them to the tweet queue
2. **Interactive Brokers Server** (`src/ib/ib_server.py`) - Python Flask server that interfaces with IB's Client Portal Web API, runs on port 3001 by default
3. **Queue** (`src/queue.ts`) - BullMQ queue configuration that connects to Redis and exports the `tweetQueue` instance
4. **Worker** (`src/worker.ts`) - BullMQ worker that processes jobs from the queue and posts tweets using the Twitter API v2

Use the shell scripts in `scripts/` directory to start the IB server:
- `./scripts/ib-server.sh` - Start the IB Web API server
- `./scripts/ib-server-random.sh` - Deprecated (no longer needed for Web API)

## Environment Variables

The application requires these environment variables:
- `TWITTER_APP_KEY` - Twitter API app key
- `TWITTER_APP_SECRET` - Twitter API app secret  
- `TWITTER_ACCESS_TOKEN` - Twitter API access token
- `TWITTER_ACCESS_SECRET` - Twitter API access secret
- `REDIS_HOST` - Redis server host
- `REDIS_PORT` - Redis server port
- `PORT` - Twitter queue server port (optional, defaults to 3000)
- `IB_SERVER_PORT` - Interactive Brokers server port (optional, defaults to 3001)
- `CP_GATEWAY_HOST` - Client Portal Gateway host (optional, defaults to 127.0.0.1)
- `CP_GATEWAY_PORT` - Client Portal Gateway port (optional, defaults to 5000)

## Dependencies

- **BullMQ** - Job queue system
- **Express** - Web framework for the API
- **Twitter API v2** - Twitter client library
- **requests** - HTTP client for Web API calls
- **Flask** - Python web framework for the IB API server
- **Redis** - Used by BullMQ for job storage
- **dotenv** - Environment variable management

## Development Notes

- The Twitter queue server, IB server, and worker are separate processes that must be run independently
- Both the Twitter queue server and worker share the same Redis connection configuration
- The IB server runs independently and connects to Client Portal Gateway
- Jobs are processed with the job name "sendTweet"
- The queue name is "tweetQueue"
- TypeScript is configured for CommonJS modules with ES2020 target

## Docker Setup

The application is containerized with Docker Compose including:
- **Redis**: Message broker for job queuing
- **App**: Express.js server on port 3000
- **Worker**: Background job processor

To run with Docker:
1. Copy `.env.example` to `.env` and fill in your Twitter API credentials and Interactive Brokers settings
2. Run `docker-compose up` to start all services
3. The API will be available at `http://localhost:3000`
4. Both server and worker logs will be visible in the console

## Interactive Brokers Integration

The IB server (`src/ib/ib_server.py`) provides Interactive Brokers integration using the Client Portal Web API. It runs on port 3001 by default.

### Setup
1. Install Python dependencies: `pip install flask requests`
2. Download and start the Client Portal Gateway:
   - Download from: https://www.interactivebrokers.com/en/index.php?f=5041
   - Run: `java -jar clientportal.gw/build/dist/clientportal.gw.jar`
   - Gateway will start on `https://localhost:5000`
3. Authenticate via the gateway web interface at `https://localhost:5000`
4. Configure environment variables for gateway host/port if needed
5. Default connection: `127.0.0.1:5000` (Client Portal Gateway)

### Available Endpoints

#### Market Data
- `GET /ib/market-data/:symbol` - Get historical market data for a symbol
  - Query parameters: 
    - `duration` (default: "10M") - Duration string like "1M", "10M", "1H", "1D", "1W", "1Y"
    - `barSize` (default: "1d") - Bar size like "1min", "5min", "1h", "1d", "1w"
    - `whatToShow` (default: "TRADES") - Data type (for compatibility, not used in Web API)

#### Contract Information
- `GET /ib/contract-details/:symbol` - Get contract details for a symbol
  - Query parameters:
    - `secType` (default: "STK") - Security type

#### System
- `GET /ib/health` - Check Client Portal Gateway authentication status
- `POST /ib/reconnect` - Manually trigger reauthentication
- `GET /ib/test-hardcoded` - Test Web API with GBL (Euro-Bund future)

### Running the Python IB Server
- Development: `python3 src/ib/ib_server.py`
- The server will make requests to Client Portal Gateway
- Requires Client Portal Gateway to be running and authenticated
- No client ID management needed (handled by gateway)