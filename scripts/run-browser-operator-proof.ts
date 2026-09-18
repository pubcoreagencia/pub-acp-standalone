import { createControlPlane } from '../src/bootstrap/createControlPlane.js';
import { ControlRoomServer } from '../src/server/ControlRoomServer.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log('--- STARTING PROOF: Browser Operator V0 E2E Proof (Shared Telemetry) ---');

  const workspacePath = '/Users/user/Documents/pubcore/sagaz-farm-os';

  const controlPlane = await createControlPlane({
    cwd: workspacePath
  });

  // Ensure sagaz-farm-os is registered
  if (!controlPlane.projectRegistry.hasProject('sagaz-farm-os')) {
    controlPlane.projectRegistry.registerProject({
      projectId: 'sagaz-farm-os',
      projectName: 'Sagaz Farm OS',
      workspacePath,
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
    dispatcher: controlPlane.dispatcher,
    browserOperator: controlPlane.browserOperator,
    authorizationEngine: controlPlane.authorizationEngine
  });

  const { url } = await server.start();
  console.log('ControlRoomServer started on:', url);

  // 1. Direct Browser Operator API tests
  console.log('\n1. Testing GET /api/browser/status');
  const statusRes = await fetch(`${url}/api/browser/status`);
  const statusData = await statusRes.json() as any;
  console.log('Browser status:', statusData);

  console.log('\n2. Testing POST /api/browser/navigate to safe local origin');
  const navRes = await fetch(`${url}/api/browser/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${url}/` })
  });
  const navData = await navRes.json() as any;
  console.log('Navigate result:', navData);

  console.log('\n3. Testing GET /api/browser/page');
  const pageRes = await fetch(`${url}/api/browser/page`);
  const pageData = await pageRes.json() as any;
  console.log(`Page title: "${pageData.title}", Text chars: ${pageData.text?.length}, Links: ${pageData.links?.length}`);

  console.log('\n4. Testing POST /api/browser/screenshot');
  const shotRes = await fetch(`${url}/api/browser/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const shotData = await shotRes.json() as any;
  console.log('Screenshot result:', {
    status: shotData.status,
    filename: shotData.filename,
    bytes: shotData.bytes
  });

  // 5. Test GPT Direct run issuing browser commands
  console.log('\n5. Testing GPT Direct Run with explicit browser tool commands');
  const startReq = {
    projectId: 'sagaz-farm-os',
    instruction: `Inspecione a estação Browser usando o comando [TOOL: browser.navigate]url=${url}/[/TOOL] e em seguida leia a página com [TOOL: browser.read][/TOOL] e tire um screenshot com [TOOL: browser.screenshot][/TOOL].`,
    executorMode: 'gpt-direct',
    maxTurns: 1
  };

  const runRes = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(startReq)
  });
  const runData = await runRes.json() as any;
  const runId = runData.runId;
  console.log('Initiated GPT Direct Run:', runId);

  let finalRun: any = null;
  for (let i = 0; i < 240; i++) {
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
  console.log('Browser Navigations:', finalRun?.browserNavigations);
  console.log('Browser Reads:', finalRun?.browserReads);
  console.log('Browser Screenshots:', finalRun?.browserScreenshots);
  console.log('Events:');
  finalRun?.events?.forEach((e: any) => console.log(`  - [${e.type}] ${e.summary}`));

  const hasAgEvents = finalRun?.events?.some((e: any) =>
    e.type.startsWith('AG_') || e.summary?.includes('Antigravity')
  );

  const report = {
    proofTimestamp: new Date().toISOString(),
    project: 'sagaz-farm-os',
    workspacePath,
    serverUrl: url,
    browserStatus: statusData,
    browserNavigation: navData,
    browserPage: {
      url: pageData.url,
      domain: pageData.domain,
      title: pageData.title,
      textSnippet: pageData.text ? pageData.text.slice(0, 150) : '',
      linksCount: pageData.links?.length || 0
    },
    browserScreenshot: shotData,
    gptDirectRun: {
      runId,
      initialRequest: startReq,
      finalRunStatus: finalRun?.status,
      executorMode: finalRun?.executorMode,
      provider: finalRun?.provider,
      totalEvents: finalRun?.events?.length || 0,
      eventTypes: finalRun?.events?.map((e: any) => e.type) || [],
      browserMetrics: {
        browserNavigations: finalRun?.browserNavigations || 0,
        browserReads: finalRun?.browserReads || 0,
        browserScreenshots: finalRun?.browserScreenshots || 0,
        agExecutions: finalRun?.agExecutions || 0
      },
      hasAgEvents,
      durationMs: finalRun?.durationMs
    }
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'BROWSER_OPERATOR_V0_E2E_REPORT.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  await server.stop();
  console.log('\nBROWSER_OPERATOR_V0_E2E_REPORT.json generated successfully.');
}

main().catch(err => {
  console.error('Proof failed with uncaught exception:', err);
  process.exit(1);
});
