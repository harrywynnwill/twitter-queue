#!/usr/bin/env python3
import os
import json
import logging
import requests
from datetime import datetime
from flask import Flask, jsonify, request
from products import PRODUCT_MAP, parse_product_from_code, list_products

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
CP_GATEWAY_HOST = os.getenv("CP_GATEWAY_HOST", "127.0.0.1")
CP_GATEWAY_PORT = int(os.getenv("CP_GATEWAY_PORT", "5000"))
SERVER_PORT = int(os.getenv("IB_SERVER_PORT", "3001"))

# Client Portal Gateway base URL
CP_BASE_URL = f"https://{CP_GATEWAY_HOST}:{CP_GATEWAY_PORT}/v1/api"

app = Flask(__name__)

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
    """Check Client Portal Gateway and authentication status"""
    try:
        # Check Client Portal Gateway connection and auth status
        response = requests.get(
            f"{CP_BASE_URL}/iserver/auth/status",
            verify=False,  # Client Portal Gateway uses self-signed cert
            timeout=10
        )
        
        if response.status_code == 200:
            auth_data = response.json()
            return jsonify({
                "status": "healthy" if auth_data.get("authenticated", False) else "not_authenticated",
                "authenticated": auth_data.get("authenticated", False),
                "connected": auth_data.get("connected", False),
                "competing": auth_data.get("competing", False),
                "gateway_host": CP_GATEWAY_HOST,
                "gateway_port": CP_GATEWAY_PORT,
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({
                "status": "error",
                "authenticated": False,
                "connected": False,
                "error": f"Gateway returned {response.status_code}",
                "gateway_host": CP_GATEWAY_HOST,
                "gateway_port": CP_GATEWAY_PORT,
                "timestamp": datetime.now().isoformat()
            }), 503
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Health check error: {e}")
        return jsonify({
            "status": "error",
            "authenticated": False,
            "connected": False,
            "error": str(e),
            "gateway_host": CP_GATEWAY_HOST,
            "gateway_port": CP_GATEWAY_PORT,
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/reconnect', methods=['POST'])
def reconnect():
    """Manually trigger reauthentication with Client Portal Gateway"""
    try:
        # Trigger reauthentication by posting to tickle endpoint
        response = requests.post(
            f"{CP_BASE_URL}/tickle",
            verify=False,
            timeout=10
        )
        
        if response.status_code == 200:
            # Check auth status after tickle
            auth_response = requests.get(
                f"{CP_BASE_URL}/iserver/auth/status",
                verify=False,
                timeout=10
            )
            
            auth_data = auth_response.json() if auth_response.status_code == 200 else {}
            
            return jsonify({
                "status": "success",
                "message": "Reauthentication triggered",
                "authenticated": auth_data.get("authenticated", False),
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({
                "status": "error",
                "message": f"Reconnect failed with status {response.status_code}",
                "timestamp": datetime.now().isoformat()
            }), 500
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Reconnect error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/market-data/<code>', methods=['GET'])
def get_market_data(code: str):
    """Get historical market data for a symbol or product code using Web API"""
    try:
        # Get query parameters
        duration = request.args.get('duration', '10M')
        bar_size = request.args.get('barSize', '1d')
        what_to_show = request.args.get('whatToShow', 'TRADES')
        
        logger.info(f"DEBUG: Starting market data request for '{code}'")
        logger.info(f"DEBUG: Request params - duration='{duration}', barSize='{bar_size}', whatToShow='{what_to_show}'")
        
        start_time = datetime.now()
        
        # Map duration and bar size to Web API format
        period_mapping = {
            '1 M': '1m', '10 M': '10m', '1 H': '1h', '1 D': '1d', 
            '1 W': '1w', '1 Y': '1y'
        }
        bar_mapping = {
            '1 min': '1min', '5 mins': '5min', '1 hour': '1h', 
            '1 day': '1d', '1 week': '1w'
        }
        
        web_period = period_mapping.get(duration, duration.lower().replace(' ', ''))
        web_bar = bar_mapping.get(bar_size, bar_size.lower().replace(' ', ''))
        logger.info(f"DEBUG: Mapped to web_period='{web_period}', web_bar='{web_bar}'")
        
        # Try to resolve symbol first
        symbol_to_use = code.upper()
        contract_info = None
        
        # Try to parse as product code first
        try:
            product_code, contract_month = parse_product_from_code(code.upper())
            logger.info(f"DEBUG: Parsed code '{code}' -> product_code='{product_code}', contract_month='{contract_month}'")
            
            if product_code in PRODUCT_MAP:
                product = PRODUCT_MAP[product_code]
                symbol_to_use = product["symbol"]
                contract_info = {
                    "secType": product["secType"],
                    "exchange": product["exchange"],
                    "currency": product["currency"]
                }
                logger.info(f"DEBUG: Using product mapping: {code} -> {product_code} -> {product}")
        except Exception as e:
            logger.error(f"DEBUG: Product parsing failed, using direct symbol: {e}")
        
        # Search for contract using Web API
        search_params = {
            "symbol": symbol_to_use,
            "name": True,
            "secType": contract_info["secType"] if contract_info else "STK"
        }
        logger.info(f"DEBUG: Searching with params: {search_params}")
        
        search_response = requests.get(
            f"{CP_BASE_URL}/iserver/secdef/search",
            params=search_params,
            verify=False,
            timeout=30
        )
        
        logger.info(f"DEBUG: Search response status: {search_response.status_code}")
        
        if search_response.status_code != 200:
            logger.error(f"DEBUG: Search failed with status {search_response.status_code}")
            logger.error(f"DEBUG: Search response text: {search_response.text}")
            return jsonify({
                "error": f"Symbol search failed: {search_response.status_code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 404
            
        try:
            search_data = search_response.json()
            logger.info(f"DEBUG: Search data type: {type(search_data)}")
            logger.info(f"DEBUG: Search data length: {len(search_data) if isinstance(search_data, list) else 'not a list'}")
            logger.info(f"DEBUG: First search result: {search_data[0] if search_data else 'empty'}")
        except Exception as e:
            logger.error(f"DEBUG: Failed to parse search response as JSON: {e}")
            logger.error(f"DEBUG: Raw response text: {search_response.text}")
            return jsonify({
                "error": f"Failed to parse search response: {str(e)}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 500
            
        if not search_data:
            logger.error(f"DEBUG: Empty search results for {code}")
            return jsonify({
                "error": f"No contract found for {code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 404
        
        # Use first contract found
        contract = search_data[0]
        conid = str(contract.get("conid", ""))
        logger.info(f"DEBUG: Using contract: {contract}")
        logger.info(f"DEBUG: Contract ID: {conid}")
        
        if not conid:
            logger.error(f"DEBUG: No contract ID found for {code}")
            return jsonify({
                "error": f"No contract ID found for {code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 404
        
        # Request historical data using Web API
        history_params = {
            "conid": conid,
            "period": web_period,
            "bar": web_bar,
            "outsideRth": "true"
        }
        logger.info(f"DEBUG: History request params: {history_params}")
        
        history_response = requests.get(
            f"{CP_BASE_URL}/iserver/marketdata/history",
            params=history_params,
            verify=False,
            timeout=60
        )
        
        logger.info(f"DEBUG: History response status: {history_response.status_code}")
        
        if history_response.status_code != 200:
            logger.error(f"DEBUG: History request failed with status {history_response.status_code}")
            logger.error(f"DEBUG: History response text: {history_response.text}")
            return jsonify({
                "error": f"Historical data request failed: {history_response.status_code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 500
        
        try:
            history_data = history_response.json()
            logger.info(f"DEBUG: History data keys: {list(history_data.keys()) if isinstance(history_data, dict) else 'not a dict'}")
            logger.info(f"DEBUG: History data sample: {str(history_data)[:500]}...")
        except Exception as e:
            logger.error(f"DEBUG: Failed to parse history response as JSON: {e}")
            logger.error(f"DEBUG: Raw history response: {history_response.text}")
            return jsonify({
                "error": f"Failed to parse history response: {str(e)}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 500
        
        # Parse and format the data
        data = []
        if "data" in history_data and history_data["data"]:
            for bar in history_data["data"]:
                data.append({
                    'time': bar.get('t', ''),  # timestamp
                    'open': float(bar.get('o', 0)),  # open
                    'high': float(bar.get('h', 0)),  # high
                    'low': float(bar.get('l', 0)),  # low
                    'close': float(bar.get('c', 0)),  # close
                    'volume': int(bar.get('v', 0)),  # volume
                    'count': 0,  # Not available in Web API
                    'wap': 0.0  # Not available in Web API
                })
        
        end_time = datetime.now()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        logger.info(f"Market data request completed in {duration_ms}ms, got {len(data)} bars")
        
        return jsonify({
            "symbol": code,
            "contract": {
                "localSymbol": contract.get("description", ""),
                "conId": conid,
                "symbol": contract.get("symbol", symbol_to_use),
                "exchange": contract.get("exchange", ""),
                "currency": contract.get("currency", "")
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
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Web API request error for {code}: {e}")
        return jsonify({
            "error": str(e),
            "symbol": code,
            "timestamp": datetime.now().isoformat()
        }), 500
    except Exception as e:
        logger.error(f"Market data error for {code}: {e}")
        return jsonify({
            "error": str(e),
            "symbol": code,
            "timestamp": datetime.now().isoformat()
        }), 500

@app.route('/ib/contract-details/<code>', methods=['GET'])
def get_contract_details(code: str):
    """Get contract details for a symbol or product code using Web API"""
    try:
        # Try to resolve symbol first
        symbol_to_use = code.upper()
        sec_type = "STK"  # Default to stock
        
        # Try to parse as product code first
        try:
            product_code, contract_month = parse_product_from_code(code.upper())
            logger.info(f"Parsed code '{code}' -> product_code='{product_code}', contract_month='{contract_month}'")
            
            if product_code in PRODUCT_MAP:
                product = PRODUCT_MAP[product_code]
                symbol_to_use = product["symbol"]
                sec_type = product["secType"]
                logger.info(f"Using product mapping: {code} -> {product_code} -> {product}")
        except Exception as e:
            logger.info(f"Product parsing failed, using direct symbol: {e}")
            # Use query parameters as fallback
            sec_type = request.args.get('secType', 'STK')
        
        logger.info(f"Requesting contract details for {code}")
        
        start_time = datetime.now()
        
        # Search for contract using Web API
        search_response = requests.get(
            f"{CP_BASE_URL}/iserver/secdef/search",
            params={
                "symbol": symbol_to_use,
                "name": True,
                "secType": sec_type
            },
            verify=False,
            timeout=30
        )
        
        if search_response.status_code != 200:
            return jsonify({
                "error": f"Contract search failed: {search_response.status_code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 404
            
        search_data = search_response.json()
        if not search_data:
            return jsonify({
                "error": f"No contract found for {code}",
                "symbol": code,
                "timestamp": datetime.now().isoformat()
            }), 404
        
        end_time = datetime.now()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        logger.info(f"Contract details request completed in {duration_ms}ms, got {len(search_data)} contracts")
        
        # Convert contract details to our format
        details_data = []
        for contract in search_data:
            contract_info = {
                "symbol": contract.get("symbol", ""),
                "secType": contract.get("secType", ""),
                "exchange": contract.get("exchange", ""),
                "currency": contract.get("currency", ""),
                "localSymbol": contract.get("description", ""),
                "conId": str(contract.get("conid", "")),
                "longName": contract.get("description", ""),
                "category": contract.get("category", ""),
                "subcategory": contract.get("subcategory", ""),
                "timeZoneId": "",  # Not available in Web API
                "tradingHours": "",  # Not available in Web API
                "liquidHours": ""  # Not available in Web API
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
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Web API request error for {code}: {e}")
        return jsonify({
            "error": str(e),
            "symbol": code,
            "timestamp": datetime.now().isoformat()
        }), 500
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
    """Test endpoint using Web API with GBL (Euro-Bund future)"""
    try:
        start_time = datetime.now()
        
        # Search for GBL contract using Web API
        search_response = requests.get(
            f"{CP_BASE_URL}/iserver/secdef/search",
            params={
                "symbol": "GBL",
                "name": True,
                "secType": "CONTFUT"
            },
            verify=False,
            timeout=30
        )
        
        if search_response.status_code != 200:
            return jsonify({
                "error": f"Contract search failed: {search_response.status_code}",
                "timestamp": datetime.now().isoformat()
            }), 404
            
        search_data = search_response.json()
        if not search_data:
            return jsonify({
                "error": "No GBL contract found",
                "timestamp": datetime.now().isoformat()
            }), 404
        
        # Use first contract found
        contract = search_data[0]
        conid = str(contract.get("conid", ""))
        
        logger.info(f"Found GBL contract: {contract.get('description', '')} {conid}")
        
        # Request historical data using Web API
        history_response = requests.get(
            f"{CP_BASE_URL}/iserver/marketdata/history",
            params={
                "conid": conid,
                "period": "1m",  # 1 month
                "bar": "1d",     # 1 day bars
                "outsideRth": "true"
            },
            verify=False,
            timeout=60
        )
        
        if history_response.status_code != 200:
            return jsonify({
                "error": f"Historical data request failed: {history_response.status_code}",
                "timestamp": datetime.now().isoformat()
            }), 500
        
        history_data = history_response.json()
        
        # Parse and format the data
        data = []
        if "data" in history_data and history_data["data"]:
            for bar in history_data["data"]:
                data.append({
                    'time': bar.get('t', ''),
                    'open': float(bar.get('o', 0)),
                    'high': float(bar.get('h', 0)),
                    'low': float(bar.get('l', 0)),
                    'close': float(bar.get('c', 0)),
                    'volume': int(bar.get('v', 0)),
                    'count': 0,  # Not available in Web API
                    'wap': 0.0  # Not available in Web API
                })
        
        logger.info(f"Got {len(data)} bars")
        
        end_time = datetime.now()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        return jsonify({
            "symbol": "GBL",
            "contract": {
                "localSymbol": contract.get("description", ""),
                "conId": conid,
                "symbol": contract.get("symbol", "GBL"),
                "exchange": contract.get("exchange", ""),
                "currency": contract.get("currency", "")
            },
            "data": data,
            "count": len(data),
            "message": "Web API test successful",
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat()
        })
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Web API request error: {e}")
        return jsonify({
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 500
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

def main():
    """Main server entry point"""
    logger.info(f"🚀 Starting IB Web API server on http://localhost:{SERVER_PORT}")
    logger.info(f"🔌 Using Client Portal Gateway at {CP_BASE_URL}")
    logger.info("ℹ️ Web API mode - requires Client Portal Gateway to be running and authenticated")
    logger.info("📋 Run 'java -jar clientportal.gw/build/dist/clientportal.gw.jar' to start the gateway")
    
    # Start Flask server
    app.run(
        host='0.0.0.0',
        port=SERVER_PORT,
        debug=False,
        use_reloader=False
    )

if __name__ == "__main__":
    main()