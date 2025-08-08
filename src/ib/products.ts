import { Contract, SecType } from "@stoqey/ib";

export const productMap: Record<string, Contract> = {
  // UK Gilt (LIFFE)
  UKGB: {
    symbol: "G",
    secType: SecType.CONTFUT,
    exchange: "LIFFE",
    currency: "GBP",
  },

  // US Treasuries (CBOT)
  UST10Y: {
    symbol: "ZN",
    secType: SecType.CONTFUT,
    exchange: "CBOT",
    currency: "USD",
  },
  UST05Y: {
    symbol: "ZF",
    secType: SecType.CONTFUT,
    exchange: "CBOT",
    currency: "USD",
  },
  UST30Y: {
    symbol: "ZB",
    secType: SecType.CONTFUT,
    exchange: "CBOT",
    currency: "USD",
  },

  // Europe (EUREX)
  EURBBL: {
    symbol: "FGBL", // Bund
    secType: SecType.CONTFUT,
    exchange: "EUREX",
    currency: "EUR",
  },
  EURSCA: {
    symbol: "FGBS", // Schatz
    secType: SecType.CONTFUT,
    exchange: "EUREX",
    currency: "EUR",
  },
  ITB10Y: {
    symbol: "FBTP", // BTP 10Y
    secType: SecType.CONTFUT,
    exchange: "EUREX",
    currency: "EUR",
  },
  EURBND: {
    symbol: "GBL", // Bobl (alt code some feeds use)
    secType: SecType.CONTFUT,
    exchange: "EUREX",
    currency: "EUR",
  },
};

