import React, { useEffect, useState } from 'react';
import { Bird, Egg, Wheat, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import { farmService } from '../application/services/farm-service';
import type { Farm } from '../domain/models';

export const DashboardPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    farm?: Farm;
    totalLots: number;
    totalLiveBirds: number;
    totalInitialBirds: number;
    totalMortality: number;
    effectiveLayRate: number;
    todayEggsCollected: number;
    todayEggsUsable: number;
    totalFeedStockKg: number;
    feedAutonomyDays: number;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const summary = await farmService.getDashboardSummary();
        setData(summary);
      } catch (err) {
        console.error('Falha ao carregar dashboard real:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 animate-pulse">
        Carregando dados operacionais reais...
      </div>
    );
  }

  if (!data || !data.farm) {
    return (
      <div className="p-6 rounded-xl bg-amber-950/20 border border-amber-800/40 text-amber-200">
        Nenhuma fazenda encontrada na persistência. Execute o seed inicial.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER REAL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">{data.farm.name}</h2>
          <p className="text-sm text-slate-400">
            {data.farm.location} • Responsável: <span className="text-slate-300 font-medium">{data.farm.ownerName}</span>
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          Dados Reais da Persistência
        </div>
      </div>

      {/* KPI METRICS GRID — 100% CALCULADO DA PERSISTÊNCIA REAL */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: PLANTEL ATIVO */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Plantel Ativo</span>
            <Bird className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white">{data.totalLiveBirds.toLocaleString('pt-BR')}</div>
            <div className="text-xs text-slate-400 mt-1">
              Aves vivas em <span className="text-slate-200 font-medium">{data.totalLots} lotes</span> ativos
            </div>
          </div>
        </div>

        {/* CARD 2: TAXA DE POSTURA */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Taxa de Postura</span>
            <TrendingUp className="w-5 h-5 text-teal-400" />
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-emerald-400">{data.effectiveLayRate}%</div>
            <div className="text-xs text-slate-400 mt-1">
              Eficiência zootécnica de coleta
            </div>
          </div>
        </div>

        {/* CARD 3: OVOS HOJE — DADOS EXATOS DA PERSISTÊNCIA, SEM FALLBACKS */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Ovos Coletados Hoje</span>
            <Egg className="w-5 h-5 text-amber-400" />
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white">
              {data.todayEggsCollected.toLocaleString('pt-BR')}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {data.todayEggsUsable.toLocaleString('pt-BR')} comercializáveis
            </div>
          </div>
        </div>

        {/* CARD 4: ESTOQUE DE RAÇÃO & AUTONOMIA REAL CALCULADA */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Estoque de Ração</span>
            <Wheat className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-4">
            <div className="text-3xl font-black text-white">{data.totalFeedStockKg.toLocaleString('pt-BR')} kg</div>
            <div className="text-xs text-slate-400 mt-1">
              {data.totalLiveBirds > 0 && data.totalFeedStockKg > 0
                ? `Autonomia calculada de ~${data.feedAutonomyDays} dias (${(115).toString()}g/ave/dia)`
                : 'Sem consumo ativo registrado'}
            </div>
          </div>
        </div>
      </div>

      {/* PAINEL DE ORIENTAÇÃO OPERACIONAL */}
      <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-emerald-400" />
          Status da Infraestrutura & Persistência Local
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          O SAGAZ FARM OS está operando com persistência transacional local (IndexedDB). Todos os lotes, coletas diárias e saldos de insumos permanecem íntegros mesmo após recarregar a janela ou fechar o dispositivo. A navegação pelas abas laterais permite a gestão completa do plantel.
        </p>
      </div>
    </div>
  );
};
