import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface ModulePlaceholderProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  targetPhase: string;
}

export const ModulePlaceholder: React.FC<ModulePlaceholderProps> = ({
  title,
  subtitle,
  icon: Icon,
  targetPhase,
}) => {
  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-2xl font-bold tracking-tight text-white">{title}</h2>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>

      <div className="p-12 rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 flex flex-col items-center justify-center text-center max-w-xl mx-auto my-12">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4 shadow-inner">
          <Icon className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          Fundação arquitetural e modelos de dados estabelecidos na Phase 1. A interface operacional completa e fluxos de trabalho avançados serão ativados na <span className="text-emerald-400 font-semibold">{targetPhase}</span> do roadmap.
        </p>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
          Programado para {targetPhase}
        </span>
      </div>
    </div>
  );
};
