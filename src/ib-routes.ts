import express from "express";
import {
  IBApi,
  EventName,
  SecType,
  BarSizeSetting,
  Contract,
} from "@stoqey/ib";

const productMap: Record<string, Contract> = {
  EURBND: {
    symbol: "GBL",
    secType: SecType.CONTFUT,
    exchange: "EUREX",
    currency: "EUR",
  },
  UST10Y: {
    symbol: "ZB",
    secType: SecType.CONTFUT,
    exchange: "CBOT",
    currency: "USD",
  },
};

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

export function createIBRoutes(ib: IBApi, ibConnected: () => boolean) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ib_connected: ibConnected(),
    });
  });

  router.post("/reconnect", (req, res) => {
    if (ibConnected()) {
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

  router.get("/market-data/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const { duration = "10 M", barSize = "1 day" } = req.query;

    const contract: Contract = productMap[symbol.slice(0, -3)];

    console.log(
      `📊 Fetching market data for ${symbol} - duration: ${duration}, barSize: ${barSize}`
    );

    try {
      if (!ibConnected()) {
        return res
          .status(503)
          .json({ success: false, error: "IB Gateway/TWS not connected" });
      }

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
          0,
          1,
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

  return router;
}