import { createControlPlane } from '../src/bootstrap/createControlPlane.js';
import { ControlRoomServer } from '../src/server/ControlRoomServer.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('--- STARTING PROOF: Control Room + Direct GPT on sagaz-farm-os ---');

  const controlPlane = await createControlPlane({
    cwd: '/Users/user/Documents/pubcore/sagaz-farm-os'
  });

  // Ensure sagaz-farm-os is in registry
  if (!controlPlane.projectRegistry.hasProject('sagaz-farm-os')) {
    controlPlane.projectRegistry.registerProject({
      projectId: 'sagaz-farm-os',
      projectName: 'Sagaz Farm OS',
      workspacePath: '/Users/user/Documents/pubcore/sagaz-farm-os',
      repository: 'pubcoreagencia/sagaz-farm-os',
      defaultBranch: 'main',
      enabled: true
    });
  }

  const server = new ControlRoomServer({
    port: 0,
    host: '127.0.0.1',
    eventBus: controlPlane.eventBus,
    runStore: controlPlane.runStore,
    projectRegistry: controlPlane.projectRegistry,
    dispatcher: controlPlane.dispatcher
  });

  const { url } = await server.start();
  console.log('ControlRoomServer started on:', url);

  const startReq = {
    projectId: 'sagaz-farm-os',
    instruction: 'Inspecionar status do repositório usando a tool git.status.',
    executorMode: 'gpt-direct',
    maxTurns: 1
  };

  const res = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(startReq)
  });

  console.log('POST /api/runs HTTP status:', res.status);
  const data = await res.json() as any;
  console.log('Initiated Run:', data);

  const runId = data.runId;
  let finalRun: any = null;

  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1000));
    finalRun = controlPlane.runStore.getRun(runId);
    console.log(`Poll [${i+1}s] state: ${finalRun?.status}, turns: ${finalRun?.gptTurns}`);
    if (['COMPLETED', 'FAILED', 'BLOCKED'].includes(finalRun?.status || '')) {
      break;
    }
  }

  console.log('\n--- EXECUTION FINISHED ---');
  console.log('Final Status:', finalRun?.status);
  console.log('Executor Mode:', finalRun?.executorMode);
  console.log('Provider:', finalRun?.provider);
  console.log('Workspace Path:', finalRun?.workspace?.path);
  console.log('Events:');
  finalRun?.events.forEach((e: any) => console.log(`  - [${e.type}] ${e.summary}`));

  const report = {
    proofTimestamp: new Date().toISOString(),
    project: 'sagaz-farm-os',
    workspacePath: '/Users/user/Documents/pubcore/sagaz-farm-os',
    serverUrl: url,
    runId,
    initialRequest: startReq,
    finalRunStatus: finalRun?.status,
    executorMode: finalRun?.executorMode,
    provider: finalRun?.provider,
    totalEvents: finalRun?.events?.length || 0,
    eventTypes: finalRun?.events?.map((e: any) => e.type) || [],
    workspaceSummary: finalRun?.workspace,
    durationMs: finalRun?.durationMs
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'CONTROL_ROOM_GPT_DIRECT_E2E_REPORT.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  await server.stop();
  console.log('CONTROL_ROOM_GPT_DIRECT_E2E_REPORT.json generated successfully.');
}

main().catch(err => {
  console.error('Fatal in proof script:', err);
  process.exit(1);
});
