from typing import Dict, Any
from ib_insync import Contract

# Product mapping for financial instruments
PRODUCT_MAP: Dict[str, Dict[str, Any]] = {
    # UK Gilt (LIFFE)
    "UKGB": {
        "symbol": "G",
        "secType": "CONTFUT",
        "exchange": "LIFFE", 
        "currency": "GBP",
    },
    
    # US Treasuries (CBOT)
    "UST10Y": {
        "symbol": "ZN",
        "secType": "CONTFUT",
        "exchange": "CBOT",
        "currency": "USD",
    },
    "UST05Y": {
        "symbol": "ZF", 
        "secType": "CONTFUT",
        "exchange": "CBOT",
        "currency": "USD",
    },
    "UST30Y": {
        "symbol": "ZB",
        "secType": "CONTFUT", 
        "exchange": "CBOT",
        "currency": "USD",
    },
    
    # Europe (EUREX)
    "EURBBL": {
        "symbol": "FGBL",  # Bund
        "secType": "CONTFUT",
        "exchange": "EUREX",
        "currency": "EUR",
    },
    "EURSCA": {
        "symbol": "FGBS",  # Schatz
        "secType": "CONTFUT",
        "exchange": "EUREX", 
        "currency": "EUR",
    },
    "ITB10Y": {
        "symbol": "FBTP",  # BTP 10Y
        "secType": "CONTFUT",
        "exchange": "EUREX",
        "currency": "EUR",
    },
    "EURBND": {
        "symbol": "GBL",  # Bobl (alt code some feeds use)
        "secType": "CONTFUT",
        "exchange": "EUREX",
        "currency": "EUR",
    },
}

def create_contract_from_product(product_code: str, contract_month: str = None) -> Contract:
    """Create IB contract from product code and optional contract month"""
    if product_code not in PRODUCT_MAP:
        raise ValueError(f"Unknown product code: {product_code}")
    
    product = PRODUCT_MAP[product_code]
    contract = Contract()
    
    contract.symbol = product["symbol"]
    contract.secType = product["secType"]
    contract.exchange = product["exchange"]
    contract.currency = product["currency"]
    
    # # Add contract month if provided (for futures)
    # if contract_month and product["secType"] == "CONTFUT":
    #     contract.lastTradeDateOrContractMonth = contract_month
    
    return contract

def get_product_info(product_code: str) -> Dict[str, Any]:
    """Get product information by code"""
    if product_code not in PRODUCT_MAP:
        raise ValueError(f"Unknown product code: {product_code}")
    
    return PRODUCT_MAP[product_code].copy()

def list_products() -> Dict[str, Dict[str, Any]]:
    """List all available products"""
    return PRODUCT_MAP.copy()

def parse_product_from_code(full_code: str) -> tuple[str, str]:
    """Parse product code and contract month from full code
    
    Example: 'EURBBLM25' -> ('EURBBL', 'M25')
    """
    if len(full_code) <= 3:
        return full_code, None
    
    # Extract last 3 characters as potential contract month
    product_code = full_code[:-3]
    contract_month = full_code[-3:]
    
    # Verify product exists
    if product_code in PRODUCT_MAP:
        return product_code, contract_month
    
    # If not found, treat entire string as product code
    return full_code, None