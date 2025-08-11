import asyncio
import logging
import time
import random
from datetime import datetime
from typing import List, Optional, Dict, Any
from ib_insync import IB, Stock, Contract, util
import nest_asyncio

# Allow nested event loops (required for Flask integration)
nest_asyncio.apply()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IBClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = 1, timeout: int = 10):
        self.host = host
        self.port = port
        self.client_id = client_id
        self.timeout = timeout
        self.ib = IB()
        self.connected = False
        self.ready = False
        
        # Setup error handling
        self.ib.errorEvent += self._on_error
        
    def _on_error(self, reqId, errorCode, errorString, contract):
        """Handle IB errors"""
        logger.error(f"IB Error {errorCode}: {errorString} (reqId: {reqId})")
        
    async def _connect_async(self) -> bool:
        """Async connection method"""
        try:
            logger.info(f"Connecting to IB at {self.host}:{self.port} with client ID {self.client_id} (timeout: {self.timeout}s)")
            
            await self.ib.connectAsync(
                host=self.host,
                port=self.port,
                clientId=self.client_id,
                timeout=self.timeout
            )
            
            # Set market data type: 2 = delayed-frozen, 1 = real-time, 3 = delayed-streaming
            self.ib.reqMarketDataType(2)
            logger.info("Set market data type to 2 (delayed-frozen)")
            
            self.connected = True
            self.ready = True
            logger.info("Successfully connected to IB")
            return True
            
        except Exception as e:
            logger.error(f"Connection error: {e}")
            self.connected = False
            self.ready = False
            return False
    
    def connect_to_ib(self, timeout: int = None) -> bool:
        """Connect to Interactive Brokers (sync wrapper)"""
        connection_timeout = timeout if timeout is not None else self.timeout
        self.timeout = connection_timeout
        
        try:
            # Run async connection in event loop
            loop = asyncio.get_event_loop()
            return loop.run_until_complete(self._connect_async())
        except RuntimeError:
            # If no event loop exists, create one
            return asyncio.run(self._connect_async())
    
    def disconnect_from_ib(self):
        """Disconnect from Interactive Brokers"""
        try:
            if self.ib.isConnected():
                self.ib.disconnect()
            self.connected = False
            self.ready = False
            logger.info("Disconnected from IB")
        except Exception as e:
            logger.error(f"Disconnect error: {e}")
    
    def is_connected(self) -> bool:
        """Check if connected to IB"""
        return self.ib.isConnected()
    
    def test_connection(self, timeout: int = 5) -> Dict[str, Any]:
        """Test connection to IB"""
        try:
            # Create temporary test client
            test_client_id = random.randint(10000, 99999)
            test_client = IBClient(self.host, self.port, test_client_id, timeout)
            
            if test_client.connect_to_ib(timeout):
                test_client.disconnect_from_ib()
                return {"connected": True}
            else:
                return {"connected": False, "error": "Connection timeout"}
        except Exception as e:
            return {"connected": False, "error": str(e)}
    
    async def _req_contract_details_async(self, contract: Contract, timeout: int = 10) -> List[Any]:
        """Async contract details request"""
        try:
            if not self.is_connected():
                raise Exception("Not connected to IB")
            
            logger.info(f"Requesting contract details for {contract.symbol}")
            details = await self.ib.reqContractDetailsAsync(contract)
            logger.info(f"Got {len(details)} contract details for {contract.symbol}")
            return details
            
        except Exception as e:
            logger.error(f"Contract details error: {e}")
            raise e
    
    def req_contract_details(self, contract: Contract, timeout: int = 10) -> List[Any]:
        """Request contract details (sync wrapper)"""
        try:
            loop = asyncio.get_event_loop()
            return loop.run_until_complete(self._req_contract_details_async(contract, timeout))
        except RuntimeError:
            return asyncio.run(self._req_contract_details_async(contract, timeout))
    
    async def _req_historical_data_async(self, contract: Contract, end_date: str = "", 
                                       duration: str = "1 D", bar_size: str = "1 hour",
                                       what_to_show: str = "TRADES", use_rth: bool = False,
                                       timeout: int = 30) -> List[Dict[str, Any]]:
        """Async historical data request"""
        try:
            if not self.is_connected():
                raise Exception("Not connected to IB")
            
            logger.info(f"DEBUG: Full contract details: {contract}")
            logger.info(f"DEBUG: Contract dict: symbol={contract.symbol}, secType={contract.secType}, exchange={contract.exchange}, currency={contract.currency}")
            logger.info(f"DEBUG: Request params - duration={duration}, barSize={bar_size}, whatToShow={what_to_show}, useRTH={use_rth}, endDateTime={end_date}")
            
            # First resolve the contract to get the specific contract (crucial for futures)
            logger.info(f"DEBUG: Resolving contract details first... (clientId: {self.client_id})")
            logger.info(f"DEBUG: Connection status - connected: {self.is_connected()}, ready: {self.ready}")
            
            try:
                resolved_contracts = await self.ib.reqContractDetailsAsync(contract)
                logger.info(f"DEBUG: Contract details request completed successfully")
            except Exception as e:
                logger.error(f"DEBUG: Contract details request failed (clientId: {self.client_id}): {e}")
                raise e
            
            if not resolved_contracts:
                logger.error(f"DEBUG: No contracts found for {contract}")
                raise Exception(f"No contract found for {contract.symbol} {contract.secType} {contract.exchange}")
            
            # Use the first resolved contract (which has conId and specific details)
            actual_contract = resolved_contracts[0].contract
            logger.info(f"DEBUG: Using resolved contract: {actual_contract.localSymbol} conId={actual_contract.conId}")
            
            logger.info(f"Requesting historical data for {actual_contract.symbol} - duration: {duration}, barSize: {bar_size} (clientId: {self.client_id})")
            
            try:
                bars = await self.ib.reqHistoricalDataAsync(
                    contract=actual_contract,  # Use resolved contract, not original
                    endDateTime=end_date,
                    durationStr=duration,
                    barSizeSetting=bar_size,
                    whatToShow=what_to_show,
                    useRTH=use_rth,
                    formatDate=1,
                    keepUpToDate=False
                )
                logger.info(f"DEBUG: Historical data request completed successfully (clientId: {self.client_id})")
            except Exception as e:
                logger.error(f"DEBUG: Historical data request failed (clientId: {self.client_id}): {e}")
                raise e
            
            logger.info(f"DEBUG: Raw bars response type: {type(bars)}, length: {len(bars) if bars else 0}")
            if bars:
                logger.info(f"DEBUG: First bar: {bars[0] if len(bars) > 0 else 'None'}")
            else:
                logger.warning("DEBUG: No bars returned from IB")
            
            # Convert bars to dict format
            data = []
            for bar in bars:
                data.append({
                    'time': bar.date.strftime('%Y%m%d %H:%M:%S') if hasattr(bar.date, 'strftime') else str(bar.date),
                    'open': float(bar.open),
                    'high': float(bar.high), 
                    'low': float(bar.low),
                    'close': float(bar.close),
                    'volume': int(bar.volume),
                    'count': int(bar.barCount) if hasattr(bar, 'barCount') else 0,
                    'wap': float(bar.average) if hasattr(bar, 'average') else 0.0
                })
            
            logger.info(f"Got {len(data)} bars for {contract.symbol}")
            return data
            
        except Exception as e:
            logger.error(f"Historical data error: {e}")
            raise e
    
    def req_historical_data(self, contract: Contract, end_date: str = "", 
                          duration: str = "1 D", bar_size: str = "1 hour",
                          what_to_show: str = "TRADES", use_rth: bool = False,
                          timeout: int = 30) -> List[Dict[str, Any]]:
        """Request historical data (sync wrapper)"""
        try:
            loop = asyncio.get_event_loop()
            return loop.run_until_complete(
                self._req_historical_data_async(contract, end_date, duration, bar_size, what_to_show, use_rth, timeout)
            )
        except RuntimeError:
            return asyncio.run(
                self._req_historical_data_async(contract, end_date, duration, bar_size, what_to_show, use_rth, timeout)
            )

def create_contract(symbol: str, sec_type: str = "STK", exchange: str = "SMART", currency: str = "USD") -> Contract:
    """Create a contract object using ib_insync"""
    if sec_type == "STK":
        return Stock(symbol, exchange, currency)
    else:
        # For other security types, use generic Contract
        contract = Contract()
        contract.symbol = symbol
        contract.secType = sec_type
        contract.exchange = exchange
        contract.currency = currency
        return contract