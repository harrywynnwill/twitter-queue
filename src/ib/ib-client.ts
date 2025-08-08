// src/ib-client.ts
import { IBApi, EventName, Contract, BarSizeSetting } from "@stoqey/ib";

export type ReadyCheck = "managedAccounts" | "nextValidId";

export class IBClient {
  private ib: IBApi;
  private connected = false;
  private ready = false;
  private reqId = 1;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly clientId: number,
    private readonly readyCheck: ReadyCheck = "managedAccounts"
  ) {
    this.ib = new IBApi({ host: this.host, port: this.port, clientId: this.clientId });

    this.ib.on(EventName.connected, () => {
      this.connected = true;
      // 1=Live, 2=Frozen, 3=Delayed, 4=Delayed-Frozen
      this.ib.reqMarketDataType(2);
      this.ib.reqCurrentTime();
      console.log("✅ Connected to IB socket");
    });

    this.ib.on(EventName.disconnected, () => {
      this.connected = false;
      this.ready = false;
      console.log("❌ Disconnected from IB socket — retrying in 5s");
      setTimeout(() => this.connect().catch(() => void 0), 5000);
    });

    if (this.readyCheck === "managedAccounts") {
      this.ib.on(EventName.managedAccounts, () => {
        this.ready = true;
        console.log("🧾 Managed accounts received — IB client ready");
      });
    } else {
      this.ib.on(EventName.nextValidId, () => {
        this.ready = true;
        console.log("🆔 nextValidId received — IB client ready");
      });
    }

    this.ib.on(EventName.error, (err) => {
      console.error("❌ IB error:", err);
    });
  }

  public async connect(): Promise<void> {
    if (this.connected) return;
    this.ib.connect(this.clientId);
    await this.waitUntilReady(12_000);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async waitUntilReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("IB handshake timeout")), timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.ib.off(EventName.managedAccounts, done);
        this.ib.off(EventName.nextValidId, done);
        this.ready = true;
        resolve();
      };
      this.ib.on(EventName.managedAccounts, done);
      this.ib.on(EventName.nextValidId, done);
    });
  }

  private nextReqId(): number {
    this.reqId = (this.reqId + 1) % 2147480000;
    if (this.reqId <= 0) this.reqId = 1;
    return this.reqId;
  }

  public async reqContractDetails(contract: Partial<Contract>, timeoutMs = 12_000) {
    await this.waitUntilReady();
    const reqId = this.nextReqId();

    return new Promise<any[]>((resolve, reject) => {
      const details: any[] = [];
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`contractDetails timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onDetails = (id: number, d: any) => {
        if (id === reqId) details.push(d);
      };
      const onEnd = (id: number) => {
        if (id === reqId) {
          cleanup();
          resolve(details);
        }
      };
      const onErr = (err: any) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.ib.off(EventName.contractDetails, onDetails);
        this.ib.off(EventName.contractDetailsEnd, onEnd);
        this.ib.off(EventName.error, onErr);
      };

      this.ib.on(EventName.contractDetails, onDetails);
      this.ib.on(EventName.contractDetailsEnd, onEnd);
      this.ib.on(EventName.error, onErr);

      this.ib.reqContractDetails(reqId, contract as Contract);
    });
  }

  public async reqHistoricalData(opts: {
    contract: Contract;
    endDateTime?: string;         // "" or "YYYYMMDD HH:MM:SS"
    durationStr: string;          // e.g. "10 D", "1 M"
    barSize: BarSizeSetting;      // e.g. BarSizeSetting.DAYS_ONE
    whatToShow?: "TRADES" | "MIDPOINT" | "BID" | "ASK" | "BID_ASK" | "ADJUSTED_LAST";
    useRTH?: 0 | 1;
    formatDate?: 1 | 2;
    keepUpToDate?: boolean;       // false for historical snapshot
    timeoutMs?: number;           // hard timeout (no data at all)
  }) {
    await this.waitUntilReady();
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

      let hardTimer: any;
      let idleTimer: any;

      const clearTimers = () => {
        if (hardTimer) clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        hardTimer = idleTimer = undefined;
      };

      const scheduleIdleResolve = () => {
        if (idleTimer) clearTimeout(idleTimer);
        // If no end event and no rows for a bit, resolve gracefully.
        idleTimer = setTimeout(() => {
          cleanup();
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

        // Some gateways send the end marker as a row
        if (typeof time === "string" && time.startsWith("finished-")) {
          cleanup();
          return resolve(rows);
        }

        // Filter sentinel rows
        if (open === -1 && close === -1) return;

        rows.push({ time, open, high, low, close, volume, count, WAP, hasGaps });

        // arm/refresh idle resolver after each real row
        scheduleIdleResolve();
      };

      const onEnd = (id: number, _start?: string, _end?: string) => {
        if (id !== reqId) return;
        cleanup();
        resolve(rows);
      };

      const onErr = (err: any) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
      };

      const cleanup = () => {
        clearTimers();
        this.ib.off(EventName.historicalData, onRow);
        // Not all builds emit historicalDataEnd
        // @ts-ignore
        this.ib.off?.(EventName.historicalDataEnd as any, onEnd);
        this.ib.off(EventName.error, onErr);
      };

      this.ib.on(EventName.historicalData, onRow);
      // @ts-ignore
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
