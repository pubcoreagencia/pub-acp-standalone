#!/usr/bin/env node
import { AcpLabClient } from '../client/acp-lab-client.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const client = new AcpLabClient();

  if (!command || command === '--help' || command === '-h') {
    console.log('PUB-ACP Standalone CLI');
    console.log('');
    console.log('Usage:');
    console.log('  acp health');
    console.log('  acp prompt "<text>" [--session <id>] [--timeout <ms>]');
    console.log('');
    console.log('Environment:');
    console.log('  ACP_LAB_URL=http://127.0.0.1:5125 (default)');
    process.exit(0);
  }

  try {
    if (command === 'health') {
      const res = await client.health();
      console.log('ACP-LAB ONLINE');
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    }

    if (command === 'prompt') {
      const promptText = args[1];
      if (!promptText) {
        console.error('Error: Prompt text required. Usage: acp prompt "<text>"');
        process.exit(1);
      }

      let sessionId: string | undefined;
      let timeoutMs: number | undefined;

      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--session' && args[i + 1]) {
          sessionId = args[i + 1];
          i++;
        } else if (args[i] === '--timeout' && args[i + 1]) {
          timeoutMs = parseInt(args[i + 1], 10);
          i++;
        }
      }

      const res = await client.prompt({
        prompt: promptText,
        session_id: sessionId,
        timeout_ms: timeoutMs
      });

      console.log('--- RESPONSE ---');
      console.log(res.response || '');
      console.log('--- METADATA ---');
      console.log(JSON.stringify({
        request_id: res.request_id,
        session_id: res.session_id,
        status: res.status,
        duration_ms: res.duration_ms,
        metadata: res.metadata
      }, null, 2));
      process.exit(0);
    }

    console.error(`Unknown command: ${command}`);
    process.exit(1);
  } catch (err: any) {
    console.error(`[ERROR] ${err.name || 'Error'}: ${err.message}`);
    if (err.code) {
      console.error(`Code: ${err.code}`);
    }
    if (err.details) {
      console.error('Details:', JSON.stringify(err.details, null, 2));
    }
    process.exit(1);
  }
}

main();
