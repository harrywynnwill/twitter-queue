// src/ib-routes.ts
import express from "express";
import { BarSizeSetting, Contract, SecType } from "@stoqey/ib";
import { IBClient } from "./ib-client";
import { productMap } from "./products";

let __reqSeq = 0;
const nextReqId = () => (++__reqSeq).toString().padStart(6, "0");

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

function logStart(route: string, reqId: string, extras: Record<string, any> = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      msg: `▶ ${route} start`,
      ts: new Date().toISOString(),
      reqId,
      ...extras,
    })
  );
}
function logInfo(reqId: string, msg: string, extras: Record<string, any> = {}) {
  console.log(JSON.stringify({ level: "info", msg, ts: new Date().toISOString(), reqId, ...extras }));
}
function logWarn(reqId: string, msg: string, extras: Record<string, any> = {}) {
  console.warn(JSON.stringify({ level: "warn", msg, ts: new Date().toISOString(), reqId, ...extras }));
}
function logError(reqId: string, msg: string, err?: unknown, extras: Record<string, any> = {}) {
  const e = err as any;
  console.error(
    JSON.stringify({
      level: "error",
      msg,
      ts: new Date().toISOString(),
      reqId,
      error: e?.message || String(e),
      stack: e?.stack,
      ...extras,
    })
  );
}

function pickContractFields(c: Partial<Contract> | undefined) {
  if (!c) return c;
  const { symbol, secType, exchange, currency, localSymbol, conId, lastTradeDateOrContractMonth } = c as any;
  return { symbol, secType, exchange, currency, localSymbol, conId, lastTradeDateOrContractMonth };
}

export function createIBRoutes(ib: IBClient) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ib_connected: ib.isConnected(),
    });
  });

  router.post("/reconnect", async (_req, res) => {
    const reqId = nextReqId();
    logStart("POST /ib/reconnect", reqId);
    try {
      await ib.connect();
      logInfo(reqId, "🔌 Reconnect successful");
      res.json({ success: true });
    } catch (e: any) {
      logError(reqId, "Reconnect failed", e);
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  });

  router.get("/ping", async (_req, res) => {
    const reqId = nextReqId();
    const t0 = nowMs();
    logStart("GET /ib/ping", reqId);
    try {
      const dt = nowMs() - t0;
      logInfo(reqId, "✅ Ready", { ms: dt });
      res.json({ ok: true, ms: dt });
    } catch (e: any) {
      logError(reqId, "Ping failed (not ready)", e);
      res.status(503).json({ ok: false, error: e?.message || String(e) });
    }
  });

  router.get("/test-connection", async (_req, res) => {
    const reqId = nextReqId();
    logStart("GET /ib/test-connection", reqId);
    try {
      const result = await ib.testConnection(5000);
      logInfo(reqId, "Connection test result", result);
      res.json(result);
    } catch (e: any) {
      logError(reqId, "Test connection failed", e);
      res.status(500).json({ connected: false, error: e?.message || String(e) });
    }
  });

  // GET /ib/contract-details?code=EURBBL
  // or explicit: ?symbol=FGBL&secType=CONTFUT&exchange=EUREX&currency=EUR
  router.get("/contract-details", async (req, res) => {
    const reqId = nextReqId();
    const t0 = nowMs();
    logStart("GET /ib/contract-details", reqId, { query: req.query });

    try {

      const {
        code,
        symbol,
        secType,
        exchange,
        currency,
        contractMonth,
        lastTradeDateOrContractMonth,
      } = req.query as Record<string, string>;

      let base: Partial<Contract> | undefined;

      if (code) {
        base = productMap[code];
        if (!base) {
          logWarn(reqId, "Unknown code", { code });
          return res.status(400).json({ ok: false, error: `Unknown code '${code}'` });
        }
      } else if (symbol && secType && exchange && currency) {
        base = { symbol, secType: secType as any, exchange, currency };
      } else {
        logWarn(reqId, "Missing params");
        return res.status(400).json({
          ok: false,
          error: "Provide either ?code=EURBBL or all of symbol,secType,exchange,currency",
        });
      }

      if (contractMonth || lastTradeDateOrContractMonth) {
        base.secType = SecType.FUT;
        base.lastTradeDateOrContractMonth = contractMonth || lastTradeDateOrContractMonth;
      }

      logInfo(reqId, "🔎 Requesting contractDetails", { base: pickContractFields(base) });
      const tCd0 = nowMs();
      const details = await ib.reqContractDetails(base as Contract, 12_000);
      const dtCd = nowMs() - tCd0;

      logInfo(reqId, "📄 contractDetails received", {
        count: details.length,
        ms: dtCd,
        first: pickContractFields(details?.[0]?.contract),
      });

      res.json({ ok: true, count: details.length, details });
      logInfo(reqId, "✅ /contract-details done", { totalMs: nowMs() - t0 });
    } catch (e: any) {
      logError(reqId, "Contract-details error", e);
      res.status(504).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // GET /ib/market-data/:code?duration=10%20D&barSize=1%20day&whatToShow=TRADES&useRTH=0
  router.get("/market-data/:code", async (req, res) => {
    const reqId = nextReqId();
    const t0 = nowMs();
    const code = req.params.code;

    const {
      duration = "10 D",
      barSize = "1 day",
      whatToShow = "TRADES",
      useRTH = "0",
      contractMonth,
      lastTradeDateOrContractMonth,
    } = req.query as Record<string, string>;

    logStart("GET /ib/market-data", reqId, {
      code,
      duration,
      barSize,
      whatToShow,
      useRTH,
      contractMonth,
      lastTradeDateOrContractMonth,
    });

    try {
      const key = code.slice(0, -3);
      const base = productMap[key];
      if (!base) {
        logWarn(reqId, "Unknown code", { code, derivedKey: key });
        return res.status(400).json({ success: false, error: `Unknown code '${code}'` });
      }

      // Build contract (allow month override → FUT, otherwise whatever map specifies)
      const contract: Contract = { ...base } as Contract;
      if (contractMonth || lastTradeDateOrContractMonth) {
        contract.secType = SecType.FUT;
        (contract as any).lastTradeDateOrContractMonth = contractMonth || lastTradeDateOrContractMonth;
      }

      logInfo(reqId, "🔎 Requesting contractDetails", { base: pickContractFields(contract) });
      const tCd0 = nowMs();
      const details = await ib.reqContractDetails(contract, 12_000);
      const dtCd = nowMs() - tCd0;

      if (!details.length) {
        logWarn(reqId, "No contract details");
        return res.status(404).json({ success: false, error: "No matching contract details" });
      }
      const resolved = details[0].contract as Contract;
      logInfo(reqId, "📄 contractDetails resolved", {
        ms: dtCd,
        resolved: pickContractFields(resolved),
        detailCount: details.length,
      });

      const enumName = barSize.replace(/\s+/g, "_").toUpperCase();
      const size =
        (BarSizeSetting as any)[enumName] ?? BarSizeSetting.DAYS_ONE;

      logInfo(reqId, "📈 Requesting historicalData", {
        mappedBarSize: enumName,
        enumResolved: size,
        duration,
        whatToShow,
        useRTH: Number(useRTH) === 1 ? 1 : 0,
      });

      const tHist0 = nowMs();
      const rows = await ib.reqHistoricalData({
        contract: resolved,
        endDateTime: "",
        durationStr: String(duration),
        barSize: size,
        whatToShow: whatToShow as any,
        useRTH: Number(useRTH) === 1 ? 1 : 0,
        formatDate: 1,
        keepUpToDate: false,
        timeoutMs: 30_000,
      });
      const dtHist = nowMs() - tHist0;

      // Summarize rows for logging
      const count = rows.length;
      const firstTime = count ? rows[0].time : null;
      const lastTime = count ? rows[count - 1].time : null;

      logInfo(reqId, "✅ historicalData received", {
        ms: dtHist,
        count,
        firstTime,
        lastTime,
      });

      res.json({ success: true, count, data: rows });
      logInfo(reqId, "✅ /market-data done", { totalMs: nowMs() - t0 });
    } catch (e: any) {
      logError(reqId, "Market-data error", e, { code });
      res.status(500).json({ success: false, error: e?.message || String(e) });
    }
  });

  router.get("/diag/tcp", async (_req, res) => {
  const net = await import("net");
  const socket = new net.Socket();
  socket.setTimeout(3000);
  socket.connect(4002, "127.0.0.1", () => { socket.destroy(); res.json({ ok: true }); });
  socket.on("timeout", () => { socket.destroy(); res.status(504).json({ ok: false, error: "timeout" }); });
  socket.on("error", (e: any) => { res.status(502).json({ ok: false, error: e.code || String(e) }); });
});

  return router;
}
