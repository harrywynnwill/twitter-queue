import asyncio
import logging
import time
import random
from datetime import datetime
from typing import List, Optional, Dict, Any
from ibapi.client import EClient
from ibapi.wrapper import EWrapper
from ibapi.contract import Contract
from ibapi.common import BarData
from threading import Thread, Event
import queue

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IBClient(EWrapper, EClient):
    def __init__(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = None, timeout: int = 10):
        EClient.__init__(self, self)
        EWrapper.__init__(self)
        
        self.host = host
        self.port = port
        self.client_id = client_id if client_id is not None else random.randint(1, 10000)
        self.timeout = timeout
        self.connected = False
        self.ready = False
        self.next_order_id = None
        
        # Request ID management
        self.req_id = 1
        
        # Data storage for requests
        self.contract_details = {}
        self.historical_data = {}
        self.request_events = {}
        
    def nextValidId(self, orderId: int):
        """Called when connection is established"""
        self.next_order_id = orderId
        self.ready = True
        logger.info(f"Connected to IB. Next valid order ID: {orderId}")
        
    def connectAck(self):
        """Called when connection is acknowledged"""
        self.connected = True
        logger.info("IB connection acknowledged")
        
    def connectionClosed(self):
        """Called when connection is closed"""
        self.connected = False
        self.ready = False
        logger.warning("IB connection closed")
        
    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = ""):
        """Handle errors"""
        logger.error(f"Error {errorCode}: {errorString} (reqId: {reqId})")
        
        # Signal error for pending requests
        if reqId in self.request_events:
            self.request_events[reqId].set()
            
    def contractDetails(self, reqId: int, contractDetails):
        """Receive contract details"""
        if reqId not in self.contract_details:
            self.contract_details[reqId] = []
        self.contract_details[reqId].append(contractDetails)
        
    def contractDetailsEnd(self, reqId: int):
        """Contract details request completed"""
        logger.info(f"Contract details completed for reqId {reqId}")
        if reqId in self.request_events:
            self.request_events[reqId].set()
            
    def historicalData(self, reqId: int, bar: BarData):
        """Receive historical data"""
        if reqId not in self.historical_data:
            self.historical_data[reqId] = []
            
        self.historical_data[reqId].append({
            'time': bar.date,
            'open': bar.open,
            'high': bar.high,
            'low': bar.low,
            'close': bar.close,
            'volume': bar.volume,
            'count': bar.barCount,
            'wap': bar.wap
        })
        
    def historicalDataEnd(self, reqId: int, start: str, end: str):
        """Historical data request completed"""
        logger.info(f"Historical data completed for reqId {reqId}")
        if reqId in self.request_events:
            self.request_events[reqId].set()
    
    def connect_to_ib(self, timeout: int = None) -> bool:
        """Connect to Interactive Brokers"""
        connection_timeout = timeout if timeout is not None else self.timeout
        
        try:
            logger.info(f"Connecting to IB at {self.host}:{self.port} with client ID {self.client_id} (timeout: {connection_timeout}s)")
            self.connect(self.host, self.port, self.client_id)
            
            # Start message processing thread
            thread = Thread(target=self.run)
            thread.daemon = True
            thread.start()
            
            # Wait for connection
            start_time = time.time()
            while not self.ready and (time.time() - start_time) < connection_timeout:
                time.sleep(0.1)
                
            if self.ready:
                logger.info("Successfully connected to IB")
                return True
            else:
                logger.error(f"Failed to connect to IB within {connection_timeout}s timeout")
                return False
                
        except Exception as e:
            logger.error(f"Connection error: {e}")
            return False
    
    def disconnect_from_ib(self):
        """Disconnect from Interactive Brokers"""
        self.disconnect()
        self.connected = False
        self.ready = False
        
    def get_next_req_id(self) -> int:
        """Get next request ID"""
        req_id = self.req_id
        self.req_id += 1
        return req_id
        
    def test_connection(self, timeout: int = 5) -> Dict[str, Any]:
        """Test connection to IB"""
        try:
            # Try to connect temporarily with random client ID
            test_client_id = random.randint(10000, 99999)
            test_client = IBClient(self.host, self.port, test_client_id, timeout)
            if test_client.connect_to_ib(timeout):
                test_client.disconnect_from_ib()
                return {"connected": True}
            else:
                return {"connected": False, "error": "Connection timeout"}
        except Exception as e:
            return {"connected": False, "error": str(e)}
    
    def req_contract_details(self, contract: Contract, timeout: int = 10) -> List[Any]:
        """Request contract details"""
        if not self.ready:
            raise Exception("Not connected to IB")
            
        req_id = self.get_next_req_id()
        self.request_events[req_id] = Event()
        
        logger.info(f"Requesting contract details for {contract.symbol} (reqId: {req_id})")
        self.reqContractDetails(req_id, contract)
        
        # Wait for response
        if self.request_events[req_id].wait(timeout):
            details = self.contract_details.get(req_id, [])
            # Cleanup
            del self.request_events[req_id]
            if req_id in self.contract_details:
                del self.contract_details[req_id]
            return details
        else:
            # Cleanup on timeout
            del self.request_events[req_id]
            if req_id in self.contract_details:
                del self.contract_details[req_id]
            raise Exception(f"Contract details request timeout for reqId {req_id}")
    
    def req_historical_data(self, contract: Contract, end_date: str = "", 
                          duration: str = "1 D", bar_size: str = "1 hour",
                          what_to_show: str = "TRADES", use_rth: int = 0,
                          timeout: int = 30) -> List[Dict[str, Any]]:
        """Request historical data"""
        if not self.ready:
            raise Exception("Not connected to IB")
            
        req_id = self.get_next_req_id()
        self.request_events[req_id] = Event()
        
        logger.info(f"Requesting historical data for {contract.symbol} (reqId: {req_id})")
        self.reqHistoricalData(
            req_id, contract, end_date, duration, bar_size,
            what_to_show, use_rth, 1, False, []
        )
        
        # Wait for response
        if self.request_events[req_id].wait(timeout):
            data = self.historical_data.get(req_id, [])
            # Cleanup
            del self.request_events[req_id]
            if req_id in self.historical_data:
                del self.historical_data[req_id]
            return data
        else:
            # Cleanup on timeout
            del self.request_events[req_id]
            if req_id in self.historical_data:
                del self.historical_data[req_id]
            raise Exception(f"Historical data request timeout for reqId {req_id}")

def create_contract(symbol: str, sec_type: str = "STK", exchange: str = "SMART", currency: str = "USD") -> Contract:
    """Create a contract object"""
    contract = Contract()
    contract.symbol = symbol
    contract.secType = sec_type
    contract.exchange = exchange
    contract.currency = currency
    return contract