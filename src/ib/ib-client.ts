import { IBApi, EventName, Contract, BarSizeSetting } from "@stoqey/ib";

export class IBClient {
  private ib: IBApi;
  private connected = false;
  private ready = false;
  private reqId = 1;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly clientId: number
  ) {
    this.ib = new IBApi({ host: this.host, port: this.port, clientId: this.clientId, timeout: 1000  });

    this.ib.on(EventName.connected, () => {
      this.connected = true;
      console.log(JSON.stringify({
        level: "info",
        msg: "IB socket connected",
        ts: new Date().toISOString(),
        host: this.host,
        port: this.port,
        clientId: this.clientId,
      }));

      // 1=Live, 2=Frozen, 3=Delayed, 4=Delayed-Frozen
      this.ib.reqMarketDataType(2);

      // Nudge the gateway to emit *something* we can call "ready"
      try { this.ib.reqIds(1); } catch {}
      try { /* some builds expose this */ // @ts-ignore
        this.ib.reqManagedAccts?.();
      } catch {}
      try { this.ib.reqCurrentTime(); } catch {}
    });

    this.ib.on(EventName.disconnected, () => {
      this.connected = false;
      this.ready = false;
      console.warn(JSON.stringify({
        level: "warn",
        msg: "IB socket disconnected; retrying in 5s",
        ts: new Date().toISOString()
      }));
      setTimeout(() => this.connect().catch(() => void 0), 5000);
    });

    // Mark "ready" if any of these arrive (but we no longer hard-require them)
    const markReady = (source: string) => {
      if (!this.ready) {
        this.ready = true;
        console.log(JSON.stringify({
          level: "info",
          msg: "IB ready signal received",
          source,
          ts: new Date().toISOString()
        }));
      }
    };
    this.ib.on(EventName.managedAccounts, () => markReady("managedAccounts"));
    this.ib.on(EventName.nextValidId, () => markReady("nextValidId"));
    this.ib.on(EventName.currentTime, () => markReady("currentTime"));

    this.ib.on(EventName.error, (err) => {
      console.error(JSON.stringify({
        level: "error",
        msg: "IB error",
        ts: new Date().toISOString(),
        error: (err as any)?.message || String(err)
      }));
    });
  }

  /** Connect and wait for TCP connect (not full handshake). */
  public async connect(): Promise<void> {
    if (this.connected) return;

    console.log(JSON.stringify({
      level: "info",
      msg: "Connecting to IB socket…",
      ts: new Date().toISOString(),
      host: this.host,
      port: this.port,
      clientId: this.clientId
    }));

    this.ib.connect(this.clientId);
    await this.waitForConnected(12_000);

    // Kick nudges again after TCP connect
    try { this.ib.reqIds(1); } catch {}
    try { /* @ts-ignore */ this.ib.reqManagedAccts?.(); } catch {}
    try { this.ib.reqCurrentTime(); } catch {}
  }

  public isConnected(): boolean {
    return this.connected;
  }

/** Quick TCP/connectivity probe without touching the main client session. */
public async testConnection(timeoutMs = 5000): Promise<{ connected: boolean; error?: string }> {
  const probeClientId = this.clientId + 10; // avoid clashing with main session
  const probe = new IBApi({ host: this.host, port: this.port, clientId: probeClientId });

  return new Promise<{ connected: boolean; error?: string }>((resolve) => {
    let done = false;
    const finish = (ok: boolean, error?: string) => {
      if (done) return;
      done = true;
      try { probe.disconnect(); } catch {}
      resolve(ok ? { connected: true } : { connected: false, error });
    };

    const timer = setTimeout(() => finish(false, `Connection timeout after ${timeoutMs}ms`), timeoutMs);

    probe.on(EventName.connected, () => {
        console.log("HELLO");
      clearTimeout(timer);
      // Nudge to ensure API is actually responsive (optional)
      try { probe.reqCurrentTime(); } catch {}
      // If you want a stronger check, wait for currentTime once with a short timeout
      let ctTimer: any = setTimeout(() => finish(true), 500); // soft success if no reply
      probe.once(EventName.currentTime, () => {
        clearTimeout(ctTimer);
        finish(true);
      });
    });

    probe.on(EventName.error, (err: any) => {
      clearTimeout(timer);
      console.log(err)
      finish(false, err?.message || String(err));
    });

    try {
      probe.connect(probeClientId);
    } catch (e: any) {
      clearTimeout(timer);
      finish(false, e?.message || String(e));
    }
  });
}

  /** Wait until TCP connected or throw. */
  public async waitForConnected(timeoutMs = 10_000): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error("IB TCP connect timeout"));
      }, timeoutMs);

      const onConn = () => { clearTimeout(t); cleanup(); resolve(); };
      const onErr = (e: any) => { clearTimeout(t); cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
      const cleanup = () => {
        this.ib.off(EventName.connected, onConn);
        this.ib.off(EventName.error, onErr);
      };

      this.ib.on(EventName.connected, onConn);
      this.ib.on(EventName.error, onErr);
    });
  }


  private nextReqId(): number {
    this.reqId = (this.reqId + 1) % 2147480000;
    if (this.reqId <= 0) this.reqId = 1;
    return this.reqId;
  }

  public async reqContractDetails(contract: Partial<Contract>, timeoutMs = 12_000) {
    await this.waitForConnected();
    const reqId = this.nextReqId();

    return new Promise<any[]>((resolve, reject) => {
      const details: any[] = [];
      const t0 = Number(process.hrtime.bigint() / 1_000_000n);

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`contractDetails timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onDetails = (id: number, d: any) => { if (id === reqId) details.push(d); };
      const onEnd = (id: number) => {
        if (id !== reqId) return;
        cleanup();
        const ms = Number(process.hrtime.bigint() / 1_000_000n) - t0;
        console.log(JSON.stringify({
          level: "info",
          msg: "contractDetails done",
          ms,
          count: details.length,
          first: pickContractFields(details?.[0]?.contract),
          ts: new Date().toISOString(),
        }));
        resolve(details);
      };
      const onErr = (err: any) => { cleanup(); reject(err instanceof Error ? err : new Error(JSON.stringify(err))); };
      const cleanup = () => {
        clearTimeout(timer);
        this.ib.off(EventName.contractDetails, onDetails);
        this.ib.off(EventName.contractDetailsEnd, onEnd);
        this.ib.off(EventName.error, onErr);
      };

      this.ib.on(EventName.contractDetails, onDetails);
      this.ib.on(EventName.contractDetailsEnd, onEnd);
      this.ib.on(EventName.error, onErr);

      console.log(JSON.stringify({
        level: "info",
        msg: "contractDetails request",
        reqId,
        base: pickContractFields(contract as any),
        ts: new Date().toISOString(),
      }));

      this.ib.reqContractDetails(reqId, contract as Contract);
    });
  }

  

  public async reqHistoricalData(opts: {
    contract: Contract;
    endDateTime?: string;
    durationStr: string;
    barSize: BarSizeSetting;
    whatToShow?: "TRADES" | "MIDPOINT" | "BID" | "ASK" | "BID_ASK" | "ADJUSTED_LAST";
    useRTH?: 0 | 1;
    formatDate?: 1 | 2;
    keepUpToDate?: boolean;
    timeoutMs?: number;
  }) {
    await this.waitForConnected();
    const {
      contract,
      endDateTime = "",
      durationStr,
      barSize,
      whatToShow = "TRADES",
      useRTH = 0,
      formatDate = 1,
      keepUpToDate = false,
      timeoutMs = 30_000,
    } = opts;

    const reqId = this.nextReqId();

    return new Promise<Array<{
      time: string;
      open: number; high: number; low: number; close: number;
      volume: number; count?: number; WAP: number; hasGaps?: boolean;
    }>>((resolve, reject) => {
      const rows: any[] = [];
      const t0 = Number(process.hrtime.bigint() / 1_000_000n);
      let hardTimer: any;
      let idleTimer: any;

      const clearTimers = () => {
        if (hardTimer) clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        hardTimer = idleTimer = undefined;
      };

      const scheduleIdleResolve = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          const ms = Number(process.hrtime.bigint() / 1_000_000n) - t0;
          console.log(JSON.stringify({
            level: "info",
            msg: "historicalData idle-resolve",
            reqId, ms, count: rows.length,
            firstTime: rows[0]?.time, lastTime: rows[rows.length - 1]?.time,
            ts: new Date().toISOString(),
          }));
          resolve(rows);
        }, 800);
      };

      hardTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`historicalData timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onRow = (
        id: number,
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
        if (id !== reqId) return;

        if (typeof time === "string" && time.startsWith("finished-")) {
          cleanup();
          const ms = Number(process.hrtime.bigint() / 1_000_000n) - t0;
          console.log(JSON.stringify({
            level: "info",
            msg: "historicalData finished-marker",
            reqId, ms, count: rows.length,
            firstTime: rows[0]?.time, lastTime: rows[rows.length - 1]?.time,
            ts: new Date().toISOString(),
          }));
          return resolve(rows);
        }

        if (open === -1 && close === -1) return;

        rows.push({ time, open, high, low, close, volume, count, WAP, hasGaps });
        scheduleIdleResolve();
      };

      const onEnd = (id: number) => {
        if (id !== reqId) return;
        cleanup();
        const ms = Number(process.hrtime.bigint() / 1_000_000n) - t0;
        console.log(JSON.stringify({
          level: "info",
          msg: "historicalData end",
          reqId, ms, count: rows.length,
          firstTime: rows[0]?.time, lastTime: rows[rows.length - 1]?.time,
          ts: new Date().toISOString(),
        }));
        resolve(rows);
      };

      const onErr = (err: any) => {
        cleanup();
        console.error(JSON.stringify({
          level: "error",
          msg: "historicalData error",
          reqId,
          error: err instanceof Error ? err.message : JSON.stringify(err),
          ts: new Date().toISOString(),
        }));
        reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
      };

      const cleanup = () => {
        clearTimers();
        this.ib.off(EventName.historicalData, onRow);
        // @ts-ignore may not exist
        this.ib.off?.(EventName.historicalDataEnd as any, onEnd);
        this.ib.off(EventName.error, onErr);
      };

      console.log(JSON.stringify({
        level: "info",
        msg: "historicalData request",
        ts: new Date().toISOString(),
        reqId,
        params: { endDateTime, durationStr, barSize, whatToShow, useRTH, formatDate, keepUpToDate },
        contract: pickContractFields(contract),
      }));

      this.ib.on(EventName.historicalData, onRow);
      // @ts-ignore may not exist
      this.ib.on?.(EventName.historicalDataEnd as any, onEnd);
      this.ib.on(EventName.error, onErr);

      this.ib.reqHistoricalData(
        reqId,
        contract,
        endDateTime,
        durationStr,
        barSize,
        whatToShow,
        useRTH,
        formatDate,
        keepUpToDate
      );
    });
  }
}

function pickContractFields(c: Partial<Contract> | undefined) {
  if (!c) return c;
  const { symbol, secType, exchange, currency, localSymbol, conId, lastTradeDateOrContractMonth } = c as any;
  return { symbol, secType, exchange, currency, localSymbol, conId, lastTradeDateOrContractMonth };
}
