#!/usr/bin/env python3
import os
import json
import logging
from datetime import datetime
from flask import Flask, jsonify, request
from ib_client_insync import IBClient, create_contract
from products import PRODUCT_MAP, create_contract_from_product, parse_product_from_code, list_products

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
IB_HOST = os.getenv("IB_HOST", "127.0.0.1")
IB_PORT = int(os.getenv("IB_PORT", "7497"))  # 7497 Paper, 7496 Live
IB_CLIENT_ID = int(os.getenv("IB_CLIENT_ID", "1"))
SERVER_PORT = int(os.getenv("IB_SERVER_PORT", "3001"))

app = Flask(__name__)

# Global IB client instance
ib_client = None

def log_request(method: str, path: str):
    """Log incoming requests"""
    timestamp = datetime.now().isoformat()
    print(f"{timestamp} {method} {path}")

@app.before_request
def before_request():
    """Log all incoming requests"""
    log_request(request.method, request.path)

@app.route('/ib/health', methods=['GET'])
def health_check():
    """Check IB server and connection status"""
    try:
        if ib_client and ib_client.ready:
            # Test connection
            test_result = ib_client.test_connection()
            return jsonify({
                "status": "healthy",
                "connected": test_result.get("connected", False),
                "host": IB_HOST,
                "port": IB_PORT,
                "client_id": IB_CLIENT_ID,
                "ready": ib_client.ready,
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({
                "status": "unhealthy",
                "connected": False,
                "ready": False,
                "error": "IB client not ready",
                "timestamp": datetime.now().isoformat()
            }), 503
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({
            "status": "error",
            "connected": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/reconnect', methods=['POST'])
def reconnect():
    """Manually reconnect to IB Gateway/TWS"""
    global ib_client
    try:
        if ib_client:
            ib_client.disconnect_from_ib()
        
        # Create new client with fixed client ID
        ib_client = IBClient(IB_HOST, IB_PORT, client_id=IB_CLIENT_ID, timeout=15)
        
        if ib_client.connect_to_ib():
            return jsonify({
                "status": "success",
                "message": "Reconnected to IB",
                "client_id": ib_client.client_id,
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to reconnect to IB",
                "timestamp": datetime.now().isoformat()
            }), 500
            
    except Exception as e:
        logger.error(f"Reconnect error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/market-data/<code>', methods=['GET'])
def get_market_data(code: str):
    """Get historical market data for a symbol or product code"""
    try:
        from ib_insync import IB, Contract
        
        # Get query parameters
        duration = request.args.get('duration', '10 M')
        bar_size = request.args.get('barSize', '1 day')
        what_to_show = request.args.get('whatToShow', 'TRADES')
        
        # Log the parameters being used
        logger.info(f"DEBUG: Request params - duration='{duration}', barSize='{bar_size}', whatToShow='{what_to_show}'")
        
        # Create fresh IB connection (like working test)
        test_ib = IB()
        test_ib.connect('127.0.0.1', 7497, clientId=3)
        test_ib.reqMarketDataType(2)  # delayed-frozen
        
        start_time = datetime.now()
        
        try:
            # Try to parse as product code first
            try:
                product_code, contract_month = parse_product_from_code(code.upper())
                logger.info(f"DEBUG: Parsed code '{code}' -> product_code='{product_code}', contract_month='{contract_month}'")
                logger.info(f"DEBUG: Available products: {list(PRODUCT_MAP.keys())}")
                
                if product_code in PRODUCT_MAP:
                    # Create contract from product mapping
                    product = PRODUCT_MAP[product_code]
                    contract = Contract(
                        symbol=product["symbol"],
                        secType=product["secType"],
                        exchange=product["exchange"],
                        currency=product["currency"]
                    )
                    logger.info(f"DEBUG: Using product mapping: {code} -> {product_code} -> {product}")
                else:
                    # Fall back to direct symbol as stock
                    contract = Contract(symbol=code.upper(), secType='STK', exchange='SMART', currency='USD')
                    logger.info(f"DEBUG: Product not found, using direct symbol as stock: {code}")
            except Exception as e:
                logger.error(f"DEBUG: Product parsing failed: {e}")
                # Fall back to direct symbol as stock
                contract = Contract(symbol=code.upper(), secType='STK', exchange='SMART', currency='USD')
                logger.info(f"DEBUG: Exception fallback to stock: {code}")
            
            logger.info(f"DEBUG: Final contract: symbol={contract.symbol}, secType={contract.secType}, exchange={contract.exchange}, currency={contract.currency}")
            
            # Resolve contract first (crucial step)
            details = test_ib.reqContractDetails(contract)
            if not details:
                test_ib.disconnect()
                return jsonify({
                    "error": f"No contract found for {code}",
                    "symbol": code,
                    "timestamp": datetime.now().isoformat()
                }), 404
            
            resolved_contract = details[0].contract
            logger.info(f"Resolved contract: {resolved_contract.localSymbol} {resolved_contract.conId}")
            
            # Request historical data using resolved contract
            bars = test_ib.reqHistoricalData(
                contract=resolved_contract,
                endDateTime='',
                durationStr=duration,
                barSizeSetting=bar_size,
                whatToShow=what_to_show,
                useRTH=False,
                formatDate=1
            )
            
            if not bars:
                test_ib.disconnect()
                return jsonify({
                    "error": f"No historical data returned for {code}",
                    "symbol": code,
                    "timestamp": datetime.now().isoformat()
                }), 404
            
            # Convert to our format
            data = []
            for bar in bars:
                data.append({
                    'time': str(bar.date),
                    'open': float(bar.open),
                    'high': float(bar.high),
                    'low': float(bar.low),
                    'close': float(bar.close),
                    'volume': int(bar.volume),
                    'count': int(bar.barCount) if hasattr(bar, 'barCount') else 0,
                    'wap': float(bar.average) if hasattr(bar, 'average') else 0.0
                })
            
            end_time = datetime.now()
            duration_ms = int((end_time - start_time).total_seconds() * 1000)
            
            logger.info(f"Market data request completed in {duration_ms}ms, got {len(data)} bars")
            
            return jsonify({
                "symbol": code,
                "contract": {
                    "localSymbol": resolved_contract.localSymbol,
                    "conId": resolved_contract.conId,
                    "symbol": resolved_contract.symbol,
                    "exchange": resolved_contract.exchange,
                    "currency": resolved_contract.currency
                },
                "duration": duration,
                "barSize": bar_size,
                "whatToShow": what_to_show,
                "data": data,
                "count": len(data),
                "requestTime": start_time.isoformat(),
                "responseTime": end_time.isoformat(),
                "durationMs": duration_ms
            })
            
        finally:
            # Always disconnect
            test_ib.disconnect()
        
    except Exception as e:
        logger.error(f"Market data error for {code}: {e}")
        return jsonify({
            "error": str(e),
            "symbol": code,
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/contract-details/<code>', methods=['GET'])
def get_contract_details(code: str):
    """Get contract details for a symbol or product code"""
    try:
        if not ib_client or not ib_client.ready:
            return jsonify({
                "error": "IB client not ready",
                "timestamp": datetime.now().isoformat()
            }), 503
        
        # Check if it's a product code via query parameter
        product_query = request.args.get('code', code)
        
        # Try product mapping first
        try:
            if product_query.upper() in PRODUCT_MAP:
                contract = create_contract_from_product(product_query.upper())
                logger.info(f"Using product mapping for contract details: {product_query}")
            else:
                # Fall back to manual parameters
                sec_type = request.args.get('secType', 'STK')
                exchange = request.args.get('exchange', 'SMART')
                currency = request.args.get('currency', 'USD')
                contract = create_contract(code.upper(), sec_type, exchange, currency)
                logger.info(f"Using manual contract creation for: {code}")
        except:
            # Fall back to manual parameters
            sec_type = request.args.get('secType', 'STK')
            exchange = request.args.get('exchange', 'SMART')
            currency = request.args.get('currency', 'USD')
            contract = create_contract(code.upper(), sec_type, exchange, currency)
            logger.info(f"Using manual contract creation for: {code}")
        
        logger.info(f"Requesting contract details for {code}")
        
        # Request contract details
        start_time = datetime.now()
        contract_details = ib_client.req_contract_details(contract)
        end_time = datetime.now()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        logger.info(f"Contract details request completed in {duration_ms}ms, got {len(contract_details)} contracts")
        
        # Convert contract details to JSON-serializable format
        details_data = []
        for detail in contract_details:
            contract_info = {
                "symbol": detail.contract.symbol,
                "secType": detail.contract.secType,
                "exchange": detail.contract.exchange,
                "currency": detail.contract.currency,
                "localSymbol": detail.contract.localSymbol,
                "conId": detail.contract.conId,
                "longName": getattr(detail, 'longName', ''),
                "category": getattr(detail, 'category', ''),
                "subcategory": getattr(detail, 'subcategory', ''),
                "timeZoneId": getattr(detail, 'timeZoneId', ''),
                "tradingHours": getattr(detail, 'tradingHours', ''),
                "liquidHours": getattr(detail, 'liquidHours', '')
            }
            details_data.append(contract_info)
        
        return jsonify({
            "symbol": code,
            "contracts": details_data,
            "count": len(details_data),
            "requestTime": start_time.isoformat(),
            "responseTime": end_time.isoformat(),
            "durationMs": duration_ms
        })
        
    except Exception as e:
        logger.error(f"Contract details error for {code}: {e}")
        return jsonify({
            "error": str(e),
            "symbol": code,
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/products', methods=['GET'])
def get_products():
    """List all available product mappings"""
    try:
        products = list_products()
        return jsonify({
            "products": products,
            "count": len(products),
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Products list error: {e}")
        return jsonify({
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/test-hardcoded', methods=['GET'])
def test_hardcoded():
    """Test endpoint with exact working code pattern"""
    try:
        from ib_insync import IB, Contract, util
        
        # Create fresh IB connection just for this test
        test_ib = IB()
        test_ib.connect('127.0.0.1', 7497, clientId=3)
        
        # Set market data type to delayed-frozen
        test_ib.reqMarketDataType(2)
        logger.info("Connected with clientId=3, set market data type to 2 (delayed-frozen)")
        
        # Define Euro-Bund future contract (exactly like working code)
        c = Contract(symbol='GBL', secType='CONTFUT', exchange='EUREX', currency='EUR')
        logger.info(f"Created contract: {c}")
        
        # Get contract details
        details = test_ib.reqContractDetails(c)
        if not details:
            test_ib.disconnect()
            return jsonify({
                "error": "No contract returned",
                "timestamp": datetime.now().isoformat()
            }), 404
            
        cont = details[0].contract
        logger.info(f"Found contract: {cont.localSymbol} {cont.conId}")
        
        # Request historical data (exactly like working code)
        bars = test_ib.reqHistoricalData(
            contract=cont,
            endDateTime='',
            durationStr='1 M',
            barSizeSetting='1 day',
            whatToShow='TRADES',
            useRTH=False,
            formatDate=1
        )
        
        if not bars:
            test_ib.disconnect()
            return jsonify({
                "error": "No historical bars returned",
                "timestamp": datetime.now().isoformat()
            }), 404
        
        logger.info(f"Got {len(bars)} bars")
        
        # Convert to our format
        data = []
        for bar in bars:
            data.append({
                'time': str(bar.date),
                'open': float(bar.open),
                'high': float(bar.high),
                'low': float(bar.low),
                'close': float(bar.close),
                'volume': int(bar.volume),
                'count': int(bar.barCount) if hasattr(bar, 'barCount') else 0,
                'wap': float(bar.average) if hasattr(bar, 'average') else 0.0
            })
        
        # Clean up
        test_ib.disconnect()
        
        return jsonify({
            "symbol": "GBL",
            "contract": {
                "localSymbol": cont.localSymbol,
                "conId": cont.conId,
                "symbol": cont.symbol,
                "exchange": cont.exchange,
                "currency": cont.currency
            },
            "data": data,
            "count": len(data),
            "message": "Hardcoded test successful",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Hardcoded test error: {e}")
        return jsonify({
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "error": "Endpoint not found",
        "timestamp": datetime.now().isoformat()
    }), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "error": "Internal server error",
        "timestamp": datetime.now().isoformat()
    }), 500

def initialize_ib_client():
    """Initialize IB client connection"""
    global ib_client
    try:
        # Use fixed client ID instead of random
        ib_client = IBClient(IB_HOST, IB_PORT, client_id=IB_CLIENT_ID, timeout=15)
        
        logger.info(f"🔄 Connecting to IB Gateway/TWS at {IB_HOST}:{IB_PORT} (clientId={ib_client.client_id})...")
        
        if ib_client.connect_to_ib():
            logger.info("✅ Successfully connected to IB Gateway/TWS")
        else:
            logger.warning("⚠️ Initial IB connect failed - server will run but /ib/reconnect can be used")
            
    except Exception as e:
        logger.error(f"⚠️ Initial IB connect failed: {e}")
        ib_client = None

def main():
    """Main server entry point"""
    logger.info(f"🚀 Starting IB HTTP server on http://localhost:{SERVER_PORT}")
    logger.info(f"🔌 Expecting IB Gateway at {IB_HOST}:{IB_PORT}")
    
    # Initialize IB client
    initialize_ib_client()
    
    # Start Flask server
    app.run(
        host='0.0.0.0',
        port=SERVER_PORT,
        debug=False,
        use_reloader=False
    )

if __name__ == "__main__":
    main()