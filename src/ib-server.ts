import express from "express";
import dotenv from "dotenv";
import { IBApi, EventName } from "@stoqey/ib";
import { createIBRoutes } from "./ib-routes";

dotenv.config();

const ib = new IBApi({
  port: parseInt(process.env.IB_PORT || "7497"),
  host: process.env.IB_HOST || "127.0.0.1",
});

let ibConnected = false;

ib.on(EventName.connected, () => {
  console.log("✅ Connected to IB Gateway/TWS");
  ib.reqMarketDataType(2);
  ibConnected = true;
});

ib.on(EventName.disconnected, () => {
  console.log("❌ Disconnected from IB Gateway/TWS");
  ibConnected = false;

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

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.use("/ib", createIBRoutes(ib, () => ibConnected));

async function startIBServer() {
  try {
    const port = process.env.IB_SERVER_PORT || 3001;
    app.listen(port, () => {
      console.log(`🚀 IB Server ready at http://localhost:${port}`);
      console.log(
        `🔌 IB Gateway expected at ${process.env.IB_HOST || "127.0.0.1"}:${
          process.env.IB_PORT || "7497"
        }`
      );
    });

    console.log("🔄 Connecting to IB Gateway/TWS...");
    ib.connect();
  } catch (err) {
    console.error("❌ Failed to start IB server:", err);
    process.exit(1);
  }
}

startIBServer();