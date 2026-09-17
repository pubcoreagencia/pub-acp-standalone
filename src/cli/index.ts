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
    console.log('  acp "<task prompt>"');
    console.log('  acp run "<task prompt>" [--turns <n>] [--model <name>]');
    console.log('  acp health');
    console.log('  acp prompt "<text>" [--session <id>] [--timeout <ms>]');
    console.log('  acp control-room [--port <number>] [--host <ip>] [--catalog <path>]');
    console.log('  acp catalog <list|validate|show|add|remove> [...]');
    console.log('');
    console.log('Catalog Commands:');
    console.log('  acp catalog list [--catalog <path>]');
    console.log('  acp catalog validate [--catalog <path>]');
    console.log('  acp catalog show <projectId> [--catalog <path>]');
    console.log('  acp catalog add <workspacePath> [--catalog <path>]');
    console.log('  acp catalog remove <projectId> [--catalog <path>]');
    console.log('');
    console.log('Environment:');
    console.log('  ACP_LAB_URL=http://127.0.0.1:5125 (default)');
    console.log('  PUB_ACP_CATALOG_PATH=<path> (optional catalog path)');
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

    if (command === 'control-room') {
      const { createControlPlane } = await import('../bootstrap/createControlPlane.js');
      const { ControlRoomServer } = await import('../server/ControlRoomServer.js');
      let port = 5173;
      let host = '127.0.0.1';
      let catalogPath: string | undefined;

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
          port = parseInt(args[i + 1], 10);
          i++;
        } else if (args[i] === '--host' && args[i + 1]) {
          host = args[i + 1];
          i++;
        } else if (args[i] === '--catalog' && args[i + 1]) {
          catalogPath = args[i + 1];
          i++;
        }
      }

      const { FileProjectCatalog } = await import('../catalog/FileProjectCatalog.js');
      const projectCatalog = catalogPath ? new FileProjectCatalog({ catalogPath }) : undefined;
      const controlPlane = await createControlPlane(projectCatalog ? { projectCatalog } : {});
      const server = new ControlRoomServer({
        port,
        host,
        dispatcher: controlPlane.dispatcher,
        projectRegistry: controlPlane.projectRegistry,
        sessionStore: controlPlane.sessionStore,
        eventBus: controlPlane.eventBus,
        runStore: controlPlane.runStore
      });
      const info = await server.start();
      console.log('==================================================');
      console.log('PUB ACP CONTROL ROOM');
      console.log('==================================================');
      console.log(`Control Room listening at: ${info.url}`);
      const projects = controlPlane.projectRegistry.listProjects();
      console.log(`Available projects (${projects.length}):`);
      for (const p of projects) {
        const isCurrent = controlPlane.currentProject?.projectId === p.projectId ? ' [CURRENT/CWD]' : '';
        console.log(`  - ${p.projectId} (${p.projectName || p.repository}) [${p.defaultBranch}]${isCurrent}`);
      }
      if (!controlPlane.currentProject) {
        console.log('Warning: No git workspace detected at current working directory.');
      }
      console.log('Open your browser to observe ClosedLoopEngine runs.');
      console.log('Press Ctrl+C to stop.');
      return;
    }

    if (command === 'catalog') {
      const subCommand = args[1];
      const subArgs = args.slice(2);

      let catalogPath: string | undefined;
      for (let i = 0; i < subArgs.length; i++) {
        if (subArgs[i] === '--catalog' && subArgs[i + 1]) {
          catalogPath = subArgs[i + 1];
          subArgs.splice(i, 2);
          i--;
        }
      }

      const { CatalogManager } = await import('../catalog/CatalogManager.js');
      const manager = new CatalogManager({ catalogPath });

      if (!subCommand || subCommand === '--help' || subCommand === '-h') {
        console.log('PUB ACP Catalog Governance');
        console.log('');
        console.log('Usage:');
        console.log('  acp catalog list [--catalog <path>] [--json]');
        console.log('  acp catalog validate [--catalog <path>] [--json]');
        console.log('  acp catalog show <projectId> [--catalog <path>] [--json]');
        console.log('  acp catalog add <workspacePath> [--catalog <path>]');
        console.log('  acp catalog remove <projectId> [--catalog <path>]');
        console.log('');
        console.log(`Active catalog file: ${manager.getCatalogPath()}`);
        process.exit(0);
      }

      const isJson = subArgs.includes('--json');

      if (subCommand === 'list') {
        const entries = await manager.list();
        if (isJson) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log('==================================================');
          console.log('AUTHORIZED PROJECT CATALOG');
          console.log('==================================================');
          console.log(`Source: ${manager.getCatalogPath()}`);
          console.log(`Projects (${entries.length}):`);
          if (entries.length === 0) {
            console.log('  (no authorized projects registered)');
          } else {
            for (const entry of entries) {
              const status = entry.enabled !== false ? 'ENABLED' : 'DISABLED';
              const branch = entry.defaultBranch ? ` [${entry.defaultBranch}]` : '';
              console.log(`  - ${entry.projectId}${branch} (${status})`);
              console.log(`    Path: ${entry.workspacePath}`);
              if (entry.projectName) {
                console.log(`    Name: ${entry.projectName}`);
              }
            }
          }
        }
        process.exit(0);
      }

      if (subCommand === 'validate') {
        const report = await manager.validate();
        if (isJson) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log('==================================================');
          console.log('PROJECT CATALOG VALIDATION REPORT');
          console.log('==================================================');
          console.log(`Catalog: ${manager.getCatalogPath()}`);
          console.log(`Total Entries: ${report.totalEntries} (Valid: ${report.validEntries})`);
          console.log(`Status: ${report.valid ? 'VALID (PASS)' : 'INVALID (FAIL CLOSED)'}`);
          if (report.issues.length > 0) {
            console.log(`\nIssues detected (${report.issues.length}):`);
            for (const issue of report.issues) {
              const pid = issue.projectId ? ` [${issue.projectId}]` : '';
              console.log(`  - [${issue.severity}]${pid} (${issue.code}): ${issue.message}`);
            }
          } else {
            console.log('\nAll registered projects physically exist, have valid Git remotes, and match integrity constraints.');
          }
        }
        process.exit(report.valid ? 0 : 1);
      }

      if (subCommand === 'show') {
        const targetId = subArgs.find(a => !a.startsWith('-'));
        if (!targetId) {
          console.error('Error: Project ID required. Usage: acp catalog show <projectId> [--catalog <path>]');
          process.exit(1);
        }

        const entry = await manager.show(targetId);
        if (!entry) {
          console.error(`Error: Project '${targetId}' not found in catalog (${manager.getCatalogPath()}).`);
          process.exit(1);
        }

        if (isJson) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          console.log('==================================================');
          console.log(`PROJECT: ${entry.projectId}`);
          console.log('==================================================');
          console.log(`Workspace:      ${entry.workspacePath}`);
          console.log(`Status:         ${entry.enabled !== false ? 'ENABLED' : 'DISABLED'}`);
          if (entry.projectName)    console.log(`Name:           ${entry.projectName}`);
          if (entry.repository)     console.log(`Repository:     ${entry.repository}`);
          if (entry.defaultBranch)  console.log(`Default Branch: ${entry.defaultBranch}`);
          if (entry.metadata)       console.log(`Metadata:       ${JSON.stringify(entry.metadata)}`);
        }
        process.exit(0);
      }

      if (subCommand === 'add') {
        const targetPath = subArgs.find(a => !a.startsWith('-'));
        if (!targetPath) {
          console.error('Error: Workspace path required. Usage: acp catalog add <workspacePath> [--catalog <path>]');
          process.exit(1);
        }

        try {
          const added = await manager.add(targetPath);
          console.log('==================================================');
          console.log('PROJECT ADDED TO AUTHORIZED CATALOG');
          console.log('==================================================');
          console.log(`Project ID: ${added.projectId}`);
          console.log(`Workspace:  ${added.workspacePath}`);
          console.log(`Catalog:    ${manager.getCatalogPath()}`);
          console.log('Authorization: GRANTED (available for Control Room execution)');
          process.exit(0);
        } catch (err: any) {
          console.error(`\n[FAIL CLOSED] Cannot add workspace to catalog:`);
          console.error(err.message);
          process.exit(1);
        }
      }

      if (subCommand === 'remove') {
        const targetId = subArgs.find(a => !a.startsWith('-'));
        if (!targetId) {
          console.error('Error: Project ID required. Usage: acp catalog remove <projectId> [--catalog <path>]');
          process.exit(1);
        }

        const removed = await manager.remove(targetId);
        if (removed) {
          console.log('==================================================');
          console.log('PROJECT REMOVED FROM AUTHORIZED CATALOG');
          console.log('==================================================');
          console.log(`Project ID: ${targetId}`);
          console.log(`Catalog:    ${manager.getCatalogPath()}`);
          console.log('Workspace files: UNTOUCHED (safe revocation)');
          process.exit(0);
        } else {
          console.error(`Error: Project '${targetId}' not found in catalog (${manager.getCatalogPath()}).`);
          process.exit(1);
        }
      }

      console.error(`Unknown catalog subcommand '${subCommand}'. Use 'acp catalog --help' for usage.`);
      process.exit(1);
    }

    if (command === 'run' || (!['health', 'prompt', 'control-room'].includes(command) && !command.startsWith('-'))) {
      const taskPrompt = command === 'run' ? args[1] : command;
      if (!taskPrompt) {
        console.error('Error: Task prompt required. Usage: acp "<task prompt>" or acp run "<task prompt>"');
        process.exit(1);
      }

      let maxTurns = 5;
      let model: string | undefined;

      const argStartIndex = command === 'run' ? 2 : 1;
      for (let i = argStartIndex; i < args.length; i++) {
        if (args[i] === '--turns' && args[i + 1]) {
          maxTurns = parseInt(args[i + 1], 10);
          i++;
        } else if (args[i] === '--model' && args[i + 1]) {
          model = args[i + 1];
          i++;
        }
      }

      const cwd = process.cwd();
      console.log('==================================================');
      console.log('PUB ACP — AUTONOMOUS CLOSED-LOOP EXECUTION');
      console.log('==================================================');
      console.log(`Workspace: ${cwd}`);
      console.log(`Task:      ${taskPrompt}`);
      console.log(`Max turns: ${maxTurns}`);
      console.log('Validating workspace and security rules...');

      const { WorkspaceResolver } = await import('../multiproject/WorkspaceResolver.js');
      const { SafetyGate } = await import('../multiproject/SafetyGate.js');
      const { ClosedLoopEngine } = await import('../bridge/ClosedLoopEngine.js');

      const resolver = new WorkspaceResolver();
      const resolution = resolver.resolveWorkspace(cwd);

      if (!resolution.ok) {
        console.error(`\n[FAIL CLOSED] Workspace resolution blocked!`);
        console.error(`Reason:  ${resolution.reason}`);
        console.error(`Message: ${resolution.message}`);
        process.exit(1);
      }

      const safetyGate = new SafetyGate();
      const safetyResult = safetyGate.evaluate(resolution);

      if (!safetyResult.passed || !safetyResult.context) {
        console.error(`\n[FAIL CLOSED] SafetyGate blocked execution!`);
        console.error(`Reason:  ${safetyResult.reason}`);
        console.error(`Message: ${safetyResult.message}`);
        process.exit(1);
      }

      const context = safetyResult.context;
      console.log(`Repository: ${context.repository} (branch: ${context.branch})`);
      console.log(`SafetyGate: PASSED`);
      console.log('\n[ClosedLoopEngine] Initializing autonomous loop...\n');

      const engine = new ClosedLoopEngine(undefined, undefined, {
        cwd: context.workspacePath,
        model,
        executionContext: context
      });

      const initialPrompt = `Você é o arquiteto técnico autônomo.
O diretório de trabalho exclusivo da tarefa é: "${context.workspacePath}".
O executor das ações no workspace é o Antigravity.
Sua missão: ${taskPrompt}

Instruções para você:
1. Responda com as instruções técnicas exatas e comandos concretos para o Antigravity executar agora neste workspace.
2. Quando a tarefa estiver concluída e validada no workspace, encerre sua mensagem com o token: [[STATUS: READY]].`;

      const report = await engine.runLoop(initialPrompt, {
        loopId: context.runId,
        maxTurns,
        executionContext: context,
        turnPromptBuilder: (prevAgResponse, turn) =>
          `[RESULTADO DO ANTIGRAVITY - TURNO ${turn - 1}]:\n"""\n${prevAgResponse}\n"""\n` +
          `Analise o resultado acima. Forneça a instrução do próximo passo para o Antigravity ou encerre com [[STATUS: READY]] se concluído.`
      });

      for (const t of report.turns) {
        console.log(`\n--- TURNO ${t.turn} ---`);
        console.log(`[GPT]: ${t.gpt_response?.slice(0, 150)}...`);
        console.log(`[AG]:  ${t.antigravity_response?.slice(0, 150)}...`);
      }

      console.log('\n==================================================');
      console.log(`EXECUTION ${report.status}`);
      console.log('==================================================');
      console.log(`Total turns:    ${report.total_turns}`);
      console.log(`Total duration: ${(report.total_duration_ms / 1000).toFixed(2)}s`);

      if (report.error) {
        console.error(`Error (${report.error.where}): ${report.error.message}`);
      }

      process.exit(report.status === 'COMPLETED' ? 0 : 1);
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
