# SAGAZ FARM OS — ARCHITECTURE DECISION RECORD (ADR-001)

## Status: DECIDED / APPROVED (Phase 1)

---

## 1. Contexto & Requisitos
O **SAGAZ FARM OS** é um sistema operacional zootécnico e financeiro de gestão avícola voltado para produtores rurais e granjas de postura (com foco em galinhas poedeiras, produção diária de ovos, controle de insumos e modelo de escala SAGAZ).
Requisitos críticos de arquitetura:
1. **Persistência Real**: Os dados devem sobreviver 100% a reload de página, fechamento de abas e restart do navegador/computador. Proibido o uso de mocks/fake APIs temporárias ou dados voláteis em memória.
2. **Ambiente Rural & Conectividade Limitada**: Granjas e galpões frequentemente possuem oscilação de sinal 4G/Wi-Fi. O sistema não pode travar ou bloquear a coleta de ovos se a internet oscilar.
3. **Multi-Unidade & Escalabilidade**: Suporte a fazendas, múltiplos galpões/piquetes e lotes de aves distintos.
4. **Isolamento de Domínio**: Regras zootécnicas e financeiras (conversão alimentar, taxa de postura, break-even) devem ser desacopladas da UI e da tecnologia de banco.
5. **Evolução para Produção & Cloud**: O padrão de repositório deve permitir migração transparente para backend relacional em nuvem (ex: Supabase / PostgreSQL) sem reescrever o domínio ou as telas.

---

## 2. Alternativas Avaliadas

### Opção A: React + Vite + TypeScript + Supabase / PostgreSQL Remoto
- **Vantagens**: Banco relacional SQL maduro, RLS (Row Level Security), autenticação robusta, backup nativo em nuvem.
- **Desvantagens no Contexto Atual**: No momento não há projeto/instância remota de Supabase provisionada no ambiente local com credenciais ativas para o SAGAZ (não se deve inventar credenciais fake). Além disso, dependência estrita de nuvem prejudica o lançamento no campo sob conectividade intermitente sem uma camada offline-first.

### Opção B: React + Vite + TypeScript + SQLite / Local Backend
- **Vantagens**: Banco relacional local ACID em arquivo único, queries SQL puras.
- **Desvantagens no Contexto Atual**: Exige a manutenção de um processo servidor backend local Node/Rust/Python em paralelo rodando no host, elevando complexidade operacional para uso móvel ou browser do produtor.

### Opção C: React + Vite + TypeScript + Dexie.js (IndexedDB Local-First) com Repository Pattern
- **Vantagens**:
  - **Persistência Real Transacional**: O IndexedDB é o banco de dados relacional/NoSQL nativo do navegador, com capacidade de armazenamento ampla (gigabytes), transações ACID, índices e persistência durável no disco rígido do cliente.
  - **Sobrevivência Absoluta**: Dados persistem integralmente a reloads, restarts do navegador e da máquina.
  - **100% Resiliente a Queda de Conexão**: Funciona offline em qualquer dispositivo (celular, tablet ou notebook no galpão).
  - **Arquitetura Desacoplada (Repository Pattern)**: O Domínio e a UI comunicam-se exclusivamente com interfaces abstratas (`IFarmRepository`, `IFlockRepository`), permitindo plugar um adapter Supabase/Postgres no futuro com zero alteração na lógica de negócio.
  - **Exportação & Backup**: Suporte nativo a dump JSON/SQL para backup do produtor.

---

## 3. Decisão
**Adotada a Opção C para a fundação do SAGAZ FARM OS (IndexedDB via Dexie.js com Repository Pattern e tipagem estrita TypeScript), estruturada para sincronização futura com Supabase/Postgres.**

### Componentes da Stack:
- **Frontend / UI**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide Icons + Recharts
- **Application & Domain Engine**: TypeScript puro, funções puras e imutáveis com cobertura 100% de testes TDD (Vitest)
- **Persistência**: IndexedDB estruturado e indexado (Dexie.js), encapsulado atrás de Repositórios de Domínio assíncronos (`Promise<T>`)
- **Autenticação**: Modo Operador Local na Phase 1 (preparado para interface de Tenant/Auth na evolução Supabase)
- **Testes**: Vitest (Test Runner moderno e ultra-rápido integrado ao ecossistema Vite)

---

## 4. Trade-offs e Mitigações
- *Trade-off*: Dados ficam inicialmente vinculados ao navegador do operador no dispositivo.
- *Mitigação*: Implementação de rotinas de exportação/backup estruturado e arquitetura pronta para adicionar sincronização na nuvem (Supabase Edge / PostgreSQL Sync) sem impacto nas camadas superiores.
