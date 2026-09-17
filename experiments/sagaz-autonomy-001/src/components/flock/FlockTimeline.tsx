import React from 'react';
import { History, Calendar, Skull, Tag, ArrowRightLeft, Syringe, Scale, CheckCircle2, Sparkles, Layers } from 'lucide-react';
import type { FlockLot, FlockLifecycleEvent } from '../../domain/models';

interface Props {
  lot: FlockLot;
  events: FlockLifecycleEvent[];
  loading: boolean;
}

export const FlockTimeline: React.FC<Props> = ({ lot, events, loading }) => {
  return (
    <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            Histórico Operacional & Rastreabilidade: {lot.code}
          </h3>
          <p className="text-xs text-slate-400">
            {lot.breed} • {lot.currentQuantity} aves vivas • Alojado em{' '}
            {new Date(lot.housingDate).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <span className="text-xs text-slate-400 bg-slate-950 px-3 py-1 rounded-full border border-slate-800">
          {events.length} eventos registrados
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400 animate-pulse p-4">Carregando linha do tempo...</div>
      ) : events.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-400">
          Nenhum evento registrado para este lote além do alojamento.
        </div>
      ) : (
        <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-6 my-4">
          {events.map((evt) => {
            let badgeColor = 'bg-slate-800 text-slate-300';
            let IconComp = Layers;
            if (evt.type === 'MORTALITY') {
              badgeColor = 'bg-red-500/20 text-red-300 border-red-500/40';
              IconComp = Skull;
            } else if (evt.type === 'DISCARD') {
              badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
              IconComp = Tag;
            } else if (evt.type === 'TRANSFER') {
              badgeColor = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
              IconComp = ArrowRightLeft;
            } else if (evt.type === 'VACCINATION') {
              badgeColor = 'bg-teal-500/20 text-teal-300 border-teal-500/40';
              IconComp = Syringe;
            } else if (evt.type === 'WEIGHING') {
              badgeColor = 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
              IconComp = Scale;
            } else if (evt.type === 'STATUS_CHANGE') {
              badgeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/40';
              IconComp = CheckCircle2;
            } else if (evt.type === 'HOUSING') {
              badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
              IconComp = Sparkles;
            }

            return (
              <div key={evt.id} className="relative group">
                <div className="absolute -left-[35px] top-0 w-6 h-6 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center text-slate-300 group-hover:border-emerald-500 transition">
                  <IconComp className="w-3 h-3 text-emerald-400" />
                </div>
                <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border uppercase ${badgeColor}`}>
                      {evt.type}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(evt.date).toLocaleString('pt-BR')}
                    </span>
                  </div>

                  {evt.type === 'MORTALITY' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Mortalidade de <span className="text-red-400 font-bold">{evt.quantity} aves</span>
                      {evt.reason ? ` • Causa: ${evt.reason}` : ''}
                    </p>
                  )}
                  {evt.type === 'DISCARD' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Descarte zootécnico de <span className="text-amber-400 font-bold">{evt.quantity} aves</span>
                      {evt.reason ? ` • Motivo: ${evt.reason}` : ''}
                    </p>
                  )}
                  {evt.type === 'TRANSFER' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Transferência de <span className="text-blue-400 font-bold">{evt.quantity} aves</span>
                      {evt.reason ? ` • Motivo: ${evt.reason}` : ''}
                    </p>
                  )}
                  {evt.type === 'VACCINATION' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Vacina: <span className="text-teal-400 font-bold">{evt.productOrProtocol}</span>
                      {evt.responsible ? ` • Resp: ${evt.responsible}` : ''}
                    </p>
                  )}
                  {evt.type === 'WEIGHING' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Peso médio: <span className="text-indigo-400 font-bold">{evt.averageWeightGrams}g</span>
                      {evt.sampleSize ? ` • Amostra de ${evt.sampleSize} aves` : ''}
                    </p>
                  )}
                  {evt.type === 'STATUS_CHANGE' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Transição de status: <span className="text-slate-400">{evt.previousStatus}</span> →{' '}
                      <span className="text-purple-400 font-bold">{evt.newStatus}</span>
                      {evt.reason ? ` • Motivo: ${evt.reason}` : ''}
                    </p>
                  )}
                  {evt.type === 'HOUSING' && (
                    <p className="text-sm text-slate-200 font-medium">
                      Alojamento inicial de <span className="text-emerald-400 font-bold">{evt.quantity} aves</span>
                    </p>
                  )}

                  {evt.notes && <p className="text-xs text-slate-400 italic mt-1">{evt.notes}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
