import express from "express";
import { tweetQueue } from "./queue";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Trade data interface
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

// Helper function to format trade messages
function formatTradeMessage(trade: TradeData): string | null {
  const { symbol, direction, volume, price, sl, tp, entry_type, close_reason, profit } = trade;
  
  if (entry_type === "ENTRY") {
    // Trade opening message
    let message = `🚀 ${direction} ${symbol} @ ${price} (${volume} lots)`;
    
    if (sl > 0) message += ` SL:${sl}`;
    if (tp > 0) message += ` TP:${tp}`;
    
    return message;
  } 
  else if (entry_type === "EXIT") {
    // Trade closing message
    let emoji = profit > 0 ? "✅" : "❌";
    let reasonText = "";
    
    switch (close_reason) {
      case "stop_loss":
        reasonText = "STOP LOSS HIT";
        emoji = "🛑";
        break;
      case "take_profit":
        reasonText = "TAKE PROFIT HIT";
        emoji = "🎯";
        break;
      case "manual_close":
        reasonText = "TRADE CLOSED";
        break;
      default:
        reasonText = "TRADE CLOSED";
    }
    
    let message = `${emoji} ${reasonText} - ${direction} ${symbol} @ ${price}`;
    message += ` | P&L: ${profit > 0 ? '+' : ''}${profit}`;
    
    return message;
  }
  
  return null; // Don't process other entry types
}

app.post("/trade", async (req, res) => {
  console.log("/trade - Received:", req.body);
  
  try {
    const trade: TradeData = req.body;
    
    // Validate required fields
    if (!trade.symbol || !trade.direction || !trade.entry_type) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: symbol, direction, entry_type" 
      });
    }
    
    // Format the message based on trade type
    const message = formatTradeMessage(trade);
    
    if (!message) {
      return res.json({ 
        success: true, 
        message: "Trade type not configured for posting" 
      });
    }
    
    // Add to tweet queue
    await tweetQueue.add("sendTweet", { 
      message,
      tradeData: trade // Include full trade data for potential future use
    });
    
    console.log("✅ Enqueued tweet:", message);
    
    res.json({ 
      success: true, 
      enqueued: message,
      tradeType: trade.entry_type,
      closeReason: trade.close_reason || null
    });
    
  } catch (error) {
    console.error("❌ Error processing trade:", error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get queue status (optional - for monitoring)
app.get("/queue/status", async (req, res) => {
  try {
    const waiting = await tweetQueue.getWaiting();
    const active = await tweetQueue.getActive();
    const completed = await tweetQueue.getCompleted();
    const failed = await tweetQueue.getFailed();
    
    res.json({
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get queue status" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening at http://localhost:${PORT}`);
  console.log(`📊 Queue status: http://localhost:${PORT}/queue/status`);
});