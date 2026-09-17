# EXPERIMENT BASELINE — SAGAZ AUTONOMY 001

## 1. Origem do Snapshot
- **Repositório Original**: `pubcoreagencia/sagaz-farm-os`
- **Caminho Local Original**: `C:\Users\Matheus Paes\Documents\ChatGPT\SAGAZ FARM OS`
- **Contexto & Descoberta**: Identificado e catalogado no `SAGAZ_PHASE_0_CHECKPOINT.md` do `PUB-ACP-POC`.
- **Commit Original**: `97710a15f31fc0df6c921f7bc09ab5e2ec75649d` (`feat(phase2): implement flock lifecycle traceability`)
- **Tag Original**: `v0.2.0`
- **Data do Snapshot**: 2026-09-16T07:59:00-03:00

---

## 2. Estrutura Copiada
O clone experimental foi criado em:
`experiments/sagaz-autonomy-001/`

Arquivos e diretórios copiados (37 arquivos, 19 subdiretórios):
- `package.json` e `package-lock.json` (React 19, Vite, Tailwind CSS, Lucide, Dexie.js v4, Vitest, fake-indexeddb)
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `vite.config.ts`, `index.html`, `.oxlintrc.json`, `.gitignore`
- `public/` (favicon e ícones SVG)
- `src/`
  - `application/services/FarmApplicationService.ts`
  - `components/` (`flock/FlockActionModal.tsx`, `flock/FlockTimeline.tsx`, `layout/AppShell.tsx`, `ui/`)
  - `domain/engine/index.ts`
  - `domain/models/index.ts`
  - `infrastructure/db/database.ts`, `infrastructure/db/seed.ts`
  - `pages/` (`DashboardPage.tsx`, `FlockPage.tsx`, `ModulePlaceholder.tsx`)
  - `repositories/` (`indexeddb-repositories.ts`, `interfaces.ts`)
  - `tests/` (`domain/domain-engine.test.ts`, `persistence/persistence.test.ts`)
- Documentação de Arquitetura herdada:
  - `ARCHITECTURE_DECISION.md`
  - `PHASE_1_FINAL_AUDIT.md`
  - `PHASE_2_FINAL_AUDIT.md`
  - `README.md`

---

## 3. Pendências Conhecidas (Roadmap pós-Phase 2)
Conforme registrado em `PHASE_2_FINAL_AUDIT.md` e `SAGAZ_PHASE_0_CHECKPOINT.md`:
- **Phase 0 & 1**: Concluídas e auditadas (Fundação, Persistência Dexie.js, Navegação, Seed, Testes de Domínio).
- **Phase 2**: Concluída e auditada (Rastreabilidade do Ciclo de Vida do Plantel, Eventos vitais com Dexie atômico, 44/44 testes passando).
- **Phase 3 (Próxima)**: Produção de Ovos, Manejo de Ração, Gestão de Estoques (`EggProduction`, `FeedStock`, `FeedConsumption`).
- **Phase 4**: Comercialização, Financeiro, Ponto de Equilíbrio (`Sale`, `Revenue`, `Expense`, `Break-even`).
- **Phase 5**: Reprodução, Incubação, Alertas & Anomalias (`HatchCycle`, `Alert`).
- **Phase 6**: Dashboard Executivo e Simulações Paramétricas de Escala.
- **Phase 7**: Modelo SAGAZ de Negócio (Viabilidade, Margens, Payback).
- **Phase 8**: E2E Testing e Polimento de Produção.

---

## 4. Diferenças entre Original e Clone
- O diretório `.git` do repositório SAGAZ **NÃO** foi copiado.
- Dependências pesadas (`node_modules`) e artefatos compilados (`dist`) **NÃO** foram copiados.
- Não existem credenciais, segredos nem arquivos `.env`.
- O clone reside inteiramente dentro de `pub-acp-standalone/experiments/sagaz-autonomy-001/` como um projeto sandbox isolado para testes de autonomia de agentes.

---

## 5. Confirmação de Isolamento
- `SAGAZ FARM OS` original: **INTOCADO** (status git clean).
- `PUB-ACP-POC` original: **INTOCADO** (status git clean).
- Repositórios e pastas vizinhas (`pub-acp-lab`, `PDL`, `PUB Neural`, `PUB PROTOTYPE`): **100% INTOCADOS**.
- Todo o ciclo autônomo subsequente será confinado em `pub-acp-standalone/experiments/sagaz-autonomy-001/`.
