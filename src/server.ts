import express from "express";
import dotenv from "dotenv";
import { IBApi, EventName, SecType, BarSizeSetting } from "@stoqey/ib";
import { tweetQueue } from "./queue";

dotenv.config();

// Create a single shared IB connection
const ib = new IBApi({
  port: parseInt(process.env.IB_PORT || "7497"),
  host: process.env.IB_HOST || "127.0.0.1",
});

let ibConnected = false;

// Set up IB connection event handlers
ib.on(EventName.connected, () => {
  console.log("✅ Connected to IB Gateway/TWS");
  ib.reqMarketDataType(2); // 2 = delayed-frozen, 1 = real-time, 3 = delayed-streaming
  ibConnected = true;
});

ib.on(EventName.disconnected, () => {
  console.log("❌ Disconnected from IB Gateway/TWS");
  ibConnected = false;

  // Attempt to reconnect after 5 seconds
  setTimeout(() => {
    if (!ibConnected) {
      console.log("🔄 Attempting to reconnect to IB Gateway/TWS...");
      ib.connect();
    }
  }, 5000);
});

ib.on(EventName.error, (err) => {
  console.error("❌ IB Error:", err);
});

const app = express();
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

interface TradeData {
  symbol: string;
  direction: string;
  volume: number;
  price: number;
  sl: number;
  tp: number;
  deal_ticket: number;
  position_ticket: number;
  entry_type: string;
  close_reason: string;
  profit: number;
  commission: number;
  swap: number;
  timestamp: number;
}

interface HistoricalBar {
  reqId: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  count?: number;
  WAP: number;
  hasGaps?: boolean;
}

function formatTradeMessage(trade: TradeData): string | null {
  const {
    symbol,
    direction,
    volume,
    price,
    sl,
    tp,
    entry_type,
    close_reason,
    profit,
  } = trade;

  if (entry_type === "ENTRY") {
    let msg = `🚀 ${direction} ${symbol} @ ${price} (${volume} lots)`;
    if (sl > 0) msg += ` SL:${sl}`;
    if (tp > 0) msg += ` TP:${tp}`;
    return msg;
  }

  if (entry_type === "EXIT") {
    let emoji = profit > 0 ? "✅" : "❌";
    let reason = "TRADE CLOSED";
    if (close_reason === "stop_loss") {
      reason = "STOP LOSS HIT";
      emoji = "🛑";
    } else if (close_reason === "take_profit") {
      reason = "TAKE PROFIT HIT";
      emoji = "🎯";
    }

    return `${emoji} ${reason} - ${direction} ${symbol} @ ${price} | P&L: ${
      profit > 0 ? "+" : ""
    }${profit}`;
  }

  return null;
}

app.post("/trade", async (req, res) => {
  try {
    const trade: TradeData = req.body;
    if (!trade.symbol || !trade.direction || !trade.entry_type) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const message = formatTradeMessage(trade);
    if (!message) {
      return res.json({ success: true, message: "Trade type not processed" });
    }

    await tweetQueue.add("sendTweet", { message, tradeData: trade });
    console.log("✅ Enqueued tweet:", message);

    res.json({ success: true, enqueued: message });
  } catch (error) {
    console.error("❌ Trade error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    ib_connected: ibConnected,
  });
});

app.post("/ib/reconnect", (req, res) => {
  if (ibConnected) {
    res.json({
      success: false,
      message: "Already connected to IB Gateway/TWS",
    });
  } else {
    console.log("🔄 Manual reconnect requested");
    ib.connect();
    res.json({ success: true, message: "Reconnection attempt initiated" });
  }
});

app.get("/queue/status", async (req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      tweetQueue.getWaiting(),
      tweetQueue.getActive(),
      tweetQueue.getCompleted(),
      tweetQueue.getFailed(),
    ]);
    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get queue status" });
  }
});

app.get("/market-data/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { duration = "10 M", barSize = "1 day" } = req.query;

  console.log(
    `📊 Fetching market data for ${symbol} - duration: ${duration}, barSize: ${barSize}`
  );

  try {
    // Check if IB connection is available
    if (!ibConnected) {
      return res
        .status(503)
        .json({ success: false, error: "IB Gateway/TWS not connected" });
    }

    const contract = {
      symbol: symbol.toUpperCase(),
      secType: SecType.CONTFUT, // Use CONTFUT for futures
      exchange: "EUREX",
      currency: "EUR",
    };

    console.log(contract);

    // First get contract details
    const contractDetails = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Contract details timeout")),
        15000
      );
      const details: any[] = [];

      ib.on(EventName.contractDetails, (reqId, contractDetail) => {
        details.push(contractDetail);
      });

      ib.on(EventName.contractDetailsEnd, (reqId) => {
        clearTimeout(timeout);
        if (details.length === 0) {
          reject(
            new Error("⚠️ No contract returned. Did you pick a valid symbol?")
          );
        } else {
          resolve(details[0]);
        }
      });

      ib.on(EventName.error, (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ib.reqContractDetails(1, contract);
    });

    const resolvedContract = contractDetails.contract;
    console.log(
      `✅ Found contract: ${resolvedContract.localSymbol}, conId: ${resolvedContract.conId}`
    );

    // Now get historical data
    const bars = await new Promise((resolve, reject) => {
      const historicalData: any[] = [];
      const timeout = setTimeout(
        () => reject(new Error("Data timeout")),
        30000
      );

      ib.on(
        EventName.historicalData,
        (
          reqId: number,
          time: string,
          open: number,
          high: number,
          low: number,
          close: number,
          volume: number,
          count: number | undefined,
          WAP: number,
          hasGaps: boolean | undefined
        ) => {
          clearTimeout(timeout);
          const bar: HistoricalBar = {
            reqId,
            time,
            open,
            high,
            low,
            close,
            volume,
            count,
            WAP,
            hasGaps,
          };
          historicalData.push(bar);
          resolve(historicalData);
        }
      );

      ib.on(EventName.error, (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ib.reqHistoricalData(
        2,
        resolvedContract,
        "",
        duration as string,
        BarSizeSetting.DAYS_ONE,
        "TRADES",
        0, // useRTH = false
        1, // formatDate = 1
        false
      );
    });

    console.log(
      `✅ Market data retrieved for ${symbol}: ${
        Array.isArray(bars) ? bars.length : 0
      } bars`
    );
    res.json({
      success: true,
      data: bars,
      count: Array.isArray(bars) ? bars.length : 0,
    });
  } catch (err) {
    console.error("❌ Market data error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

async function startServer() {
  try {
    // Start the HTTP server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`🚀 Server ready at http://localhost:${port}`);
      console.log(
        `🔌 IB Gateway expected at ${process.env.IB_HOST || "127.0.0.1"}:${
          process.env.IB_PORT || "7497"
        }`
      );
    });

    // Initialize IB connection
    console.log("🔄 Connecting to IB Gateway/TWS...");
    ib.connect();
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
