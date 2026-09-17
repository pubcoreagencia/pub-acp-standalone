import React, { useState } from 'react';
import { Skull, Tag, ArrowRightLeft, Syringe, Scale, CheckCircle2, AlertCircle } from 'lucide-react';
import type { FlockLot, FarmUnit, FlockStatus } from '../../domain/models';

export type ActionType = 'MORTALITY' | 'DISCARD' | 'TRANSFER' | 'VACCINATION' | 'WEIGHING' | 'STATUS_CHANGE';

interface Props {
  action: ActionType;
  lot: FlockLot;
  units: FarmUnit[];
  onClose: () => void;
  onSubmit: (data: {
    quantity?: number;
    reason?: string;
    notes?: string;
    toUnitId?: string;
    productOrProtocol?: string;
    responsible?: string;
    averageWeightGrams?: number;
    sampleSize?: number;
    newStatus?: FlockStatus;
  }) => Promise<void>;
}

export const FlockActionModal: React.FC<Props> = ({ action, lot, units, onClose, onSubmit }) => {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const otherUnits = units.filter((u) => u.id !== lot.farmUnitId);
  const [toUnitId, setToUnitId] = useState<string>(otherUnits.length > 0 ? otherUnits[0].id : '');
  const [product, setProduct] = useState<string>('');
  const [responsible, setResponsible] = useState<string>('');
  const [weight, setWeight] = useState<number>(0);
  const [sampleSize, setSampleSize] = useState<number>(0);
  const [newStatus, setNewStatus] = useState<FlockStatus>(lot.status === 'laying' ? 'low_productivity' : 'laying');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        quantity: Number(quantity),
        reason,
        notes,
        toUnitId,
        productOrProtocol: product,
        responsible,
        averageWeightGrams: Number(weight),
        sampleSize: Number(sampleSize),
        newStatus,
      });
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Erro ao registrar evento.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          {action === 'MORTALITY' && <Skull className="w-5 h-5 text-red-400" />}
          {action === 'DISCARD' && <Tag className="w-5 h-5 text-amber-400" />}
          {action === 'TRANSFER' && <ArrowRightLeft className="w-5 h-5 text-blue-400" />}
          {action === 'VACCINATION' && <Syringe className="w-5 h-5 text-teal-400" />}
          {action === 'WEIGHING' && <Scale className="w-5 h-5 text-indigo-400" />}
          {action === 'STATUS_CHANGE' && <CheckCircle2 className="w-5 h-5 text-purple-400" />}
          {action === 'MORTALITY' && 'Registrar Mortalidade'}
          {action === 'DISCARD' && 'Registrar Descarte Zootécnico'}
          {action === 'TRANSFER' && 'Transferir Lote entre Galpões'}
          {action === 'VACCINATION' && 'Registrar Aplicação de Vacina'}
          {action === 'WEIGHING' && 'Registrar Amostragem de Peso'}
          {action === 'STATUS_CHANGE' && 'Alterar Status do Lote'}
        </h3>
        <p className="text-xs text-slate-400">
          Lote: <span className="text-white font-semibold">{lot.code}</span> • Saldo atual:{' '}
          <span className="text-emerald-400 font-bold">{lot.currentQuantity} aves</span>
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {(action === 'MORTALITY' || action === 'DISCARD') && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Quantidade de Aves Afetadas
              </label>
              <input
                type="number"
                min="1"
                max={lot.currentQuantity}
                required
                value={quantity || ''}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                placeholder={`Máximo: ${lot.currentQuantity}`}
              />
            </div>
          )}

          {action === 'TRANSFER' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Galpão / Unidade de Destino</label>
              <select
                value={toUnitId}
                onChange={(e) => setToUnitId(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                {otherUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {action === 'VACCINATION' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Produto / Vacina / Protocolo</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Newcastle H120"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Responsável pela Aplicação</label>
                <input
                  type="text"
                  placeholder="ex: Veterinário / Operador"
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </>
          )}

          {action === 'WEIGHING' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Peso Médio (g)</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="ex: 1850"
                  value={weight || ''}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Tamanho da Amostra</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="ex: 50"
                  value={sampleSize || ''}
                  onChange={(e) => setSampleSize(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          {action === 'STATUS_CHANGE' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Novo Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as FlockStatus)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="growth">growth (Crescimento)</option>
                <option value="laying">laying (Postura Comercial)</option>
                <option value="reproduction">reproduction (Reprodução)</option>
                <option value="low_productivity">low_productivity (Baixa Produtividade)</option>
                <option value="discard">discard (Descarte Programado)</option>
                <option value="sold">sold (Lote Vendido)</option>
              </select>
            </div>
          )}

          {(action === 'MORTALITY' ||
            action === 'DISCARD' ||
            action === 'TRANSFER' ||
            action === 'STATUS_CHANGE') && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Motivo / Causa</label>
              <input
                type="text"
                placeholder="ex: Causas naturais, transição térmica, etc."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Observações Complementares</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition disabled:opacity-50"
            >
              {submitting ? 'Gravando...' : 'Registrar Evento Atômico'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
