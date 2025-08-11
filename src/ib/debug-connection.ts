// Quick diagnostic script for local IB connection issues
import net from 'net';

const HOST = process.env.IB_HOST || "127.0.0.1";
const PORT = parseInt("4002", 10);
const CLIENT_ID = parseInt(process.env.IB_CLIENT_ID || "1", 10);

console.log('🔍 IB Gateway Connection Diagnostics');
console.log('=====================================');
console.log(`Target: ${HOST}:${PORT}`);
console.log(`Client ID: ${CLIENT_ID}`);
console.log('');

async function testTcpConnection(host: string, port: number): Promise<boolean> {
  console.log(`1. Testing TCP connection to ${host}:${port}...`);
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try { socket.destroy(); } catch {}
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      console.log(`   ❌ FAILED: Connection timeout (5s)`);
      console.log(`   💡 This usually means:`);
      console.log(`      - IB Gateway/TWS is not running`);
      console.log(`      - Wrong port (try 7496 for Live, 7497 for Paper)`);
      console.log(`      - Firewall blocking the connection`);
      resolve(false);
    }, 5000);

    socket.connect(port, host, () => {
      clearTimeout(timeout);
      cleanup();
      console.log(`   ✅ SUCCESS: TCP connection established`);
      resolve(true);
    });

    socket.on('error', (err: any) => {
      clearTimeout(timeout);
      cleanup();
      console.log(`   ❌ FAILED: ${err.message}`);
      
      if (err.code === 'ECONNREFUSED') {
        console.log(`   💡 Connection refused means:`);
        console.log(`      - IB Gateway/TWS is not running on port ${port}`);
        console.log(`      - Check if Gateway is started and API is enabled`);
      } else if (err.code === 'EHOSTUNREACH') {
        console.log(`   💡 Host unreachable means:`);
        console.log(`      - Network/DNS issue with ${host}`);
        console.log(`      - Try 'localhost' instead of '127.0.0.1'`);
      }
      resolve(false);
    });

    socket.on('data', (data) => {
      console.log(`   📡 Received data: ${data.toString().slice(0, 50)}...`);
    });
  });
}

async function checkCommonPorts() {
  console.log(`\n2. Checking common IB ports...`);
  
  const ports = [7497, 7496, 4001, 4002];
  for (const port of ports) {
    const portType = port === 7497 ? '(Paper)' : port === 7496 ? '(Live)' : port === 4001 ? '(Gateway Paper)' : '(Gateway Live)';
    process.stdout.write(`   Port ${port} ${portType}: `);
    
    const isOpen = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);

      socket.connect(port, HOST, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });

    console.log(isOpen ? '✅ Open' : '❌ Closed');
  }
}

function printTroubleshootingSteps() {
  console.log(`\n3. IB Gateway/TWS Configuration Checklist:`);
  console.log(`   ☐ Is IB Gateway or TWS running?`);
  console.log(`   ☐ API Settings: Configure → Settings → API → Settings`);
  console.log(`   ☐ "Enable ActiveX and Socket Clients" checked?`);
  console.log(`   ☐ Port matches: ${PORT} (7497=Paper, 7496=Live)`);
  console.log(`   ☐ "Read-Only API" checked? (for market data only)`);
  console.log(`   ☐ Client ID ${CLIENT_ID} not already in use?`);
  console.log(`   ☐ Check "Trusted IPs" list includes 127.0.0.1`);
  console.log(`   ☐ No firewall blocking port ${PORT}?`);
  console.log(`\n4. Alternative Host/Port Combinations to Try:`);
  console.log(`   • HOST=localhost PORT=7497 (Paper Trading)`);
  console.log(`   • HOST=127.0.0.1 PORT=7496 (Live Trading)`);
  console.log(`   • HOST=127.0.0.1 PORT=4001 (Gateway Paper)`);
  console.log(`   • CLIENT_ID=100 (or any unused number)`);
}

async function testIbApiConnection() {
  console.log(`\n5. Testing IB API connection...`);
  
  try {
    // Import your IBClient if available
    const { IBClient } = await import('./ib-client');
    const client = new IBClient(HOST, PORT, CLIENT_ID + 1000); // Use different client ID for testing
    
    console.log(`   📡 Testing with probe client...`);
    const result = await client.testConnection(8000);
    
    if (result.connected) {
      console.log(`   ✅ IB API connection successful!`);
      console.log(`   💡 Your main client should work with CLIENT_ID=${CLIENT_ID}`);
    } else {
      console.log(`   ❌ IB API connection failed: ${result.error}`);
      console.log(`   💡 Even though TCP works, API handshake failed`);
      console.log(`   💡 Check Client ID conflicts or API permissions`);
    }
  } catch (error) {
    console.log(`   ⚠️  Could not test IB API: ${error}`);
    console.log(`   💡 Make sure to run this from your project directory`);
  }
}

async function main() {
  const tcpWorks = await testTcpConnection(HOST, PORT);
  
  if (!tcpWorks) {
    await checkCommonPorts();
    printTroubleshootingSteps();
    console.log(`\n❌ Primary connection failed. Fix TCP connectivity first.`);
    return;
  }

  console.log(`\n✅ TCP connection successful! Testing IB API layer...`);
  await testIbApiConnection();
  
  console.log(`\n🔧 If API connection fails, try:`);
  console.log(`   1. Different CLIENT_ID (current: ${CLIENT_ID})`);
  console.log(`   2. Restart IB Gateway/TWS`);
  console.log(`   3. Check Gateway's client connections panel`);
  console.log(`   4. Verify API permissions in Gateway settings`);
}

// Run diagnostics
main().catch(console.error);