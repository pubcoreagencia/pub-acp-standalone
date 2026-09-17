import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Edit3, Bird, AlertCircle, Skull, Tag, ArrowRightLeft, Syringe, Scale, CheckCircle2 } from 'lucide-react';
import { farmService } from '../application/services/farm-service';
import type { FlockLot, FarmUnit, FlockLifecycleEvent, FlockStatus } from '../domain/models';
import { FlockTimeline } from '../components/flock/FlockTimeline';
import { FlockActionModal, type ActionType } from '../components/flock/FlockActionModal';

export const FlockPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [lotsWithUnits, setLotsWithUnits] = useState<Array<{ lot: FlockLot; unitName: string }>>([]);
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Selected Lot for Detail / Timeline
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [events, setEvents] = useState<FlockLifecycleEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Modals state
  const [showCreateEditModal, setShowCreateEditModal] = useState(false);
  const [activeActionModal, setActiveActionModal] = useState<ActionType | null>(null);
  const [targetLot, setTargetLot] = useState<FlockLot | null>(null);

  // Create/Edit form
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [breed, setBreed] = useState('');
  const [farmUnitId, setFarmUnitId] = useState('');
  const [initialQuantity, setInitialQuantity] = useState(0);
  const [currentQuantity, setCurrentQuantity] = useState(0);
  const [accumulatedMortality, setAccumulatedMortality] = useState(0);
  const [acquisitionCost, setAcquisitionCost] = useState(0);
  const [notes, setNotes] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const summary = await farmService.getDashboardSummary();
      if (summary.farm) {
        const u = await farmService.listUnits(summary.farm.id);
        setUnits(u);
        if (u.length > 0 && !farmUnitId) {
          setFarmUnitId(u[0].id);
        }
      }
      const data = await farmService.listLotsWithUnits();
      setLotsWithUnits(data);

      if (data.length > 0 && !selectedLotId) {
        setSelectedLotId(data[0].lot.id);
        await loadEvents(data[0].lot.id);
      } else if (selectedLotId) {
        await loadEvents(selectedLotId);
      }
    } catch (err) {
      console.error('Erro ao carregar lotes:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents(lotId: string) {
    setLoadingEvents(true);
    try {
      const evts = await farmService.listEventsByLotId(lotId);
      setEvents(evts);
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
    } finally {
      setLoadingEvents(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSelectLot(lotId: string) {
    setSelectedLotId(lotId);
    await loadEvents(lotId);
  }

  function handleOpenCreate() {
    setEditingLotId(null);
    setCode(`LOTE-${Date.now().toString().slice(-4)}`);
    setBreed('');
    setInitialQuantity(0);
    setCurrentQuantity(0);
    setAccumulatedMortality(0);
    setAcquisitionCost(0);
    setNotes('');
    setFormError(null);
    setShowCreateEditModal(true);
  }

  function handleOpenEdit(lot: FlockLot) {
    setEditingLotId(lot.id);
    setCode(lot.code);
    setBreed(lot.breed);
    setFarmUnitId(lot.farmUnitId);
    setInitialQuantity(lot.initialQuantity);
    setCurrentQuantity(lot.currentQuantity);
    setAccumulatedMortality(lot.accumulatedMortality);
    setAcquisitionCost(lot.acquisitionCostPerBird);
    setNotes(lot.notes || '');
    setFormError(null);
    setShowCreateEditModal(true);
  }

  function handleOpenAction(lot: FlockLot, action: ActionType) {
    setTargetLot(lot);
    setActiveActionModal(action);
  }

  async function handleSubmitCreateEdit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      if (editingLotId) {
        await farmService.updateFlockLot(editingLotId, {
          code,
          breed,
          farmUnitId,
          initialQuantity: Number(initialQuantity),
          currentQuantity: Number(currentQuantity),
          accumulatedMortality: Number(accumulatedMortality),
          acquisitionCostPerBird: Number(acquisitionCost),
          notes,
        });
      } else {
        const created = await farmService.createFlockLot({
          code,
          breed,
          farmUnitId,
          housingDate: new Date().toISOString(),
          initialQuantity: Number(initialQuantity),
          currentQuantity: Number(currentQuantity),
          accumulatedMortality: Number(accumulatedMortality),
          status: 'laying',
          acquisitionCostPerBird: Number(acquisitionCost),
          notes,
        });
        setSelectedLotId(created.id);
      }
      setShowCreateEditModal(false);
      await loadData();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Erro inesperado ao salvar lote.');
      }
    }
  }

  async function handleExecuteAction(data: {
    quantity?: number;
    reason?: string;
    notes?: string;
    toUnitId?: string;
    productOrProtocol?: string;
    responsible?: string;
    averageWeightGrams?: number;
    sampleSize?: number;
    newStatus?: FlockStatus;
  }) {
    if (!targetLot || !activeActionModal) return;
    const todayIso = new Date().toISOString();

    switch (activeActionModal) {
      case 'MORTALITY':
        await farmService.recordMortality({
          flockLotId: targetLot.id,
          quantity: data.quantity || 0,
          date: todayIso,
          reason: data.reason,
          notes: data.notes,
        });
        break;
      case 'DISCARD':
        await farmService.recordDiscard({
          flockLotId: targetLot.id,
          quantity: data.quantity || 0,
          date: todayIso,
          reason: data.reason,
          notes: data.notes,
        });
        break;
      case 'TRANSFER':
        await farmService.recordTransfer({
          flockLotId: targetLot.id,
          toUnitId: data.toUnitId || '',
          date: todayIso,
          reason: data.reason,
          notes: data.notes,
        });
        break;
      case 'VACCINATION':
        await farmService.recordVaccination({
          flockLotId: targetLot.id,
          productOrProtocol: data.productOrProtocol || '',
          responsible: data.responsible,
          date: todayIso,
          notes: data.notes,
        });
        break;
      case 'WEIGHING':
        await farmService.recordWeighing({
          flockLotId: targetLot.id,
          averageWeightGrams: data.averageWeightGrams || 0,
          sampleSize: data.sampleSize || 0,
          date: todayIso,
          notes: data.notes,
        });
        break;
      case 'STATUS_CHANGE':
        await farmService.changeFlockStatus({
          flockLotId: targetLot.id,
          newStatus: data.newStatus || 'laying',
          date: todayIso,
          reason: data.reason,
          notes: data.notes,
        });
        break;
    }

    await loadData();
    if (selectedLotId) {
      await loadEvents(selectedLotId);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deseja realmente remover este lote da persistência real? Todos os dados associados serão removidos.')) return;
    try {
      await farmService.deleteFlockLot(id);
      if (selectedLotId === id) setSelectedLotId(null);
      await loadData();
    } catch (err) {
      console.error('Erro ao excluir lote:', err);
    }
  }

  const activeSelectedLot = lotsWithUnits.find((item) => item.lot.id === selectedLotId)?.lot;

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Bird className="w-6 h-6 text-emerald-400" />
            Plantel & Ciclo de Vida Auditável
          </h2>
          <p className="text-sm text-slate-400">
            Cada alteração no saldo de aves é explicada por eventos auditáveis: mortalidade, descarte, vacinações e pesagens.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Novo Lote de Aves
        </button>
      </div>

      {/* LOTS TABLE */}
      {loading ? (
        <div className="text-slate-400 text-sm animate-pulse p-4">Carregando lotes persistidos...</div>
      ) : lotsWithUnits.length === 0 ? (
        <div className="p-8 text-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
          Nenhum lote cadastrado. Clique no botão acima para criar o primeiro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/80">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/80 text-xs uppercase text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Linhagem</th>
                <th className="px-4 py-3">Unidade / Galpão</th>
                <th className="px-4 py-3 text-right">Inicial</th>
                <th className="px-4 py-3 text-right">Vivas (Saldo)</th>
                <th className="px-4 py-3 text-right">Mortalidade</th>
                <th className="px-4 py-3 text-right">Descarte</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Ações Operacionais</th>
                <th className="px-4 py-3 text-right">Editar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {lotsWithUnits.map(({ lot, unitName }) => {
                const isSelected = lot.id === selectedLotId;
                return (
                  <tr
                    key={lot.id}
                    onClick={() => handleSelectLot(lot.id)}
                    className={`cursor-pointer transition ${
                      isSelected ? 'bg-emerald-950/30 border-l-4 border-l-emerald-500' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                      <Bird className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{lot.code}</span>
                      {isSelected && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/40">
                          Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{lot.breed}</td>
                    <td className="px-4 py-3 text-slate-400">{unitName}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{lot.initialQuantity.toLocaleString('pt-BR')}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-400">
                      {lot.currentQuantity.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 font-medium">
                      {lot.accumulatedMortality}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-400 font-medium">
                      {lot.accumulatedDiscard || 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        {lot.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'MORTALITY')}
                          className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition"
                          title="Registrar Mortalidade"
                        >
                          <Skull className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'DISCARD')}
                          className="p-1.5 rounded hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 transition"
                          title="Registrar Descarte"
                        >
                          <Tag className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'TRANSFER')}
                          className="p-1.5 rounded hover:bg-blue-500/20 text-slate-400 hover:text-blue-400 transition"
                          title="Transferir Galpão"
                        >
                          <ArrowRightLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'VACCINATION')}
                          className="p-1.5 rounded hover:bg-teal-500/20 text-slate-400 hover:text-teal-400 transition"
                          title="Registrar Vacinação"
                        >
                          <Syringe className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'WEIGHING')}
                          className="p-1.5 rounded hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 transition"
                          title="Registrar Pesagem"
                        >
                          <Scale className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAction(lot, 'STATUS_CHANGE')}
                          className="p-1.5 rounded hover:bg-purple-500/20 text-slate-400 hover:text-purple-400 transition"
                          title="Alterar Status"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(lot)}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                        title="Editar Lote"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(lot.id)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition"
                        title="Excluir Lote"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TIMELINE COMPONENT */}
      {activeSelectedLot && (
        <FlockTimeline lot={activeSelectedLot} events={events} loading={loadingEvents} />
      )}

      {/* ACTION MODAL */}
      {activeActionModal && targetLot && (
        <FlockActionModal
          action={activeActionModal}
          lot={targetLot}
          units={units}
          onClose={() => setActiveActionModal(null)}
          onSubmit={handleExecuteAction}
        />
      )}

      {/* CREATE / EDIT LOT MODAL */}
      {showCreateEditModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">
              {editingLotId ? 'Editar Lote de Aves' : 'Cadastrar Novo Lote'}
            </h3>

            {formError && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitCreateEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Código do Lote</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Linhagem</label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Isa Brown"
                    value={breed}
                    onChange={(e) => setBreed(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Unidade / Galpão</label>
                  <select
                    value={farmUnitId}
                    onChange={(e) => setFarmUnitId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Qtd. Inicial</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={initialQuantity || ''}
                    onChange={(e) => setInitialQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Qtd. Atual</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={currentQuantity}
                    onChange={(e) => setCurrentQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Mortalidade</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={accumulatedMortality}
                    onChange={(e) => setAccumulatedMortality(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Custo por Ave (R$)</label>
                <input
                  type="number"
                  step="0.10"
                  min="0"
                  required
                  value={acquisitionCost || ''}
                  onChange={(e) => setAcquisitionCost(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Observações</label>
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
                  onClick={() => setShowCreateEditModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition"
                >
                  Salvar na Persistência
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
