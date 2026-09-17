import { useEffect, useState } from 'react';
import { AppShell, type NavTab } from './components/layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { FlockPage } from './pages/FlockPage';
import { ModulePlaceholder } from './pages/ModulePlaceholder';
import { seedInitialFarmData } from './infrastructure/db/seed';
import { Egg, Wheat, RotateCcw, ShoppingBag, CircleDollarSign, AlertTriangle, LineChart } from 'lucide-react';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [seeding, setSeeding] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        await seedInitialFarmData();
      } catch (err) {
        console.error('Falha ao inicializar seed:', err);
      } finally {
        setSeeding(false);
      }
    }
    init();
  }, []);

  if (seeding) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 font-sans gap-3">
        <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        <p className="text-sm font-medium tracking-tight">Inicializando banco de dados real do SAGAZ FARM OS...</p>
      </div>
    );
  }

  return (
    <AppShell currentTab={currentTab} onNavigate={setCurrentTab}>
      {currentTab === 'dashboard' && <DashboardPage />}
      {currentTab === 'flock' && <FlockPage />}
      {currentTab === 'production' && (
        <ModulePlaceholder
          title="Produção Diária & Classificação de Ovos"
          subtitle="Apontamento diário de postura, taxa de perda, ovos trincados e estoque de dúzias."
          icon={Egg}
          targetPhase="PHASE 3"
        />
      )}
      {currentTab === 'feed' && (
        <ModulePlaceholder
          title="Ração & Controle de Insumos"
          subtitle="Controle de sacaria, consumo diário em gramas por ave e conversão alimentar."
          icon={Wheat}
          targetPhase="PHASE 3"
        />
      )}
      {currentTab === 'reproduction' && (
        <ModulePlaceholder
          title="Reprodução & Incubação"
          subtitle="Ciclos de chocadeira, previsão de eclosão, taxa de fertilidade e nascimentos."
          icon={RotateCcw}
          targetPhase="PHASE 5"
        />
      )}
      {currentTab === 'sales' && (
        <ModulePlaceholder
          title="Vendas & Clientes"
          subtitle="Emissão de pedidos, controle de entregas de ovos, clientes recorrentes e precificação."
          icon={ShoppingBag}
          targetPhase="PHASE 4"
        />
      )}
      {currentTab === 'finance' && (
        <ModulePlaceholder
          title="Financeiro & Break-Even"
          subtitle="DRE simplificado da granja, fluxo de caixa, ponto de equilíbrio e custo por ovo."
          icon={CircleDollarSign}
          targetPhase="PHASE 4"
        />
      )}
      {currentTab === 'alerts' && (
        <ModulePlaceholder
          title="Alertas & Anomalias"
          subtitle="Detecção automática de quedas de postura, desvios de mortalidade e estoque crítico."
          icon={AlertTriangle}
          targetPhase="PHASE 5"
        />
      )}
      {currentTab === 'sagaz' && (
        <ModulePlaceholder
          title="Modelo SAGAZ & Simulação de Escala"
          subtitle="Planejamento de expansão de galpões, projeção de retorno financeiro e modelo de franquia rural."
          icon={LineChart}
          targetPhase="PHASE 6 & PHASE 7"
        />
      )}
    </AppShell>
  );
}

export default App;
