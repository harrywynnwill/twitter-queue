import express from "express";
import dotenv from "dotenv";
import { IBClient } from "./ib-client";
import { createIBRoutes } from "./ib-routes";

dotenv.config();

const HOST = process.env.IB_HOST || "127.0.0.1";                 // Docker on Mac/Win: host.docker.internal
const PORT = parseInt(process.env.IB_PORT || "7497", 10);        // 7497 Paper, 7496 Live
const CLIENT_ID = parseInt(process.env.IB_CLIENT_ID || "42", 10);
const SERVER_PORT = parseInt(process.env.IB_SERVER_PORT || "3001", 10);

async function main() {
  const ib = new IBClient(HOST, PORT, CLIENT_ID, "managedAccounts");

  // Start Express first
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
  app.use("/ib", createIBRoutes(ib));

  app.listen(SERVER_PORT, () => {
    console.log(`🚀 IB HTTP server on http://localhost:${SERVER_PORT}`);
    console.log(`🔌 Expecting IB Gateway at ${HOST}:${PORT} (clientId=${CLIENT_ID})`);
  });

  // Then connect to IB (with auto-retry inside)
  try {
    console.log("🔄 Connecting to IB Gateway/TWS…");
    await ib.connect();
  } catch (e: any) {
    console.error("⚠️ Initial IB connect failed:", e?.message || String(e));
    // server still runs; /ib/reconnect can be used
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
