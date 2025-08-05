import express from "express";
import dotenv from "dotenv";
import { tweetQueue } from "./queue";

dotenv.config();

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
  });
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

async function startServer() {
  try {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`🚀 Twitter Queue Server ready at http://localhost:${port}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();