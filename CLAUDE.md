# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Twitter queue system built with TypeScript that uses BullMQ for job queuing and Redis for message storage. It provides an Express.js REST API to queue tweets and a worker process to send them via the Twitter API.

## Key Commands

### Development (Local)
- `npm run dev` - Start the Express server in development mode with auto-reload
- `npm run worker` - Start the worker process to process queued tweets
- `ts-node src/server.ts` - Run the server directly 
- `ts-node src/worker.ts` - Run the worker directly

### Production
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start the compiled server
- `npm run start:worker` - Start the compiled worker

### Docker
- `docker-compose up` - Start all services (Redis, server, worker)
- `docker-compose up -d` - Start services in background
- `docker-compose down` - Stop all services
- `docker-compose logs` - View logs from all services
- `docker-compose logs app` - View server logs only
- `docker-compose logs worker` - View worker logs only

## Architecture

The system consists of three main components:

1. **Server** (`src/server.ts`) - Express.js REST API with a single POST `/tweet` endpoint that accepts a message and adds it to the queue
2. **Queue** (`src/queue.ts`) - BullMQ queue configuration that connects to Redis and exports the `tweetQueue` instance
3. **Worker** (`src/worker.ts`) - BullMQ worker that processes jobs from the queue and posts tweets using the Twitter API v2

## Environment Variables

The application requires these environment variables:
- `TWITTER_APP_KEY` - Twitter API app key
- `TWITTER_APP_SECRET` - Twitter API app secret  
- `TWITTER_ACCESS_TOKEN` - Twitter API access token
- `TWITTER_ACCESS_SECRET` - Twitter API access secret
- `REDIS_HOST` - Redis server host
- `REDIS_PORT` - Redis server port
- `PORT` - Server port (optional, defaults to 3000)

## Dependencies

- **BullMQ** - Job queue system
- **Express** - Web framework for the API
- **Twitter API v2** - Twitter client library
- **Redis** - Used by BullMQ for job storage
- **dotenv** - Environment variable management

## Development Notes

- The server and worker are separate processes that must be run independently
- Both processes share the same Redis connection configuration
- Jobs are processed with the job name "sendTweet"
- The queue name is "tweetQueue"
- TypeScript is configured for CommonJS modules with ES2020 target

## Docker Setup

The application is containerized with Docker Compose including:
- **Redis**: Message broker for job queuing
- **App**: Express.js server on port 3000
- **Worker**: Background job processor

To run with Docker:
1. Copy `.env.example` to `.env` and fill in your Twitter API credentials
2. Run `docker-compose up` to start all services
3. The API will be available at `http://localhost:3000`
4. Both server and worker logs will be visible in the console