import React from 'react';
import {
  LayoutDashboard,
  Bird,
  Egg,
  Wheat,
  RotateCcw,
  ShoppingBag,
  CircleDollarSign,
  AlertTriangle,
  LineChart,
  Menu,
  X,
  ShieldCheck,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'flock'
  | 'production'
  | 'feed'
  | 'reproduction'
  | 'sales'
  | 'finance'
  | 'alerts'
  | 'sagaz';

interface ShellProps {
  currentTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  children: React.ReactNode;
}

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'flock', label: 'Plantel & Lotes', icon: Bird },
  { id: 'production', label: 'Produção Diária', icon: Egg },
  { id: 'feed', label: 'Ração & Estoque', icon: Wheat },
  { id: 'reproduction', label: 'Reprodução', icon: RotateCcw },
  { id: 'sales', label: 'Vendas', icon: ShoppingBag },
  { id: 'finance', label: 'Financeiro', icon: CircleDollarSign },
  { id: 'alerts', label: 'Alertas', icon: AlertTriangle },
  { id: 'sagaz', label: 'Modelo SAGAZ', icon: LineChart, badge: 'PRO' },
];

export const AppShell: React.FC<ShellProps> = ({ currentTab, onNavigate, children }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row antialiased font-sans">
      {/* MOBILE TOP BAR */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-black">
            S
          </div>
          <span className="font-bold tracking-tight text-white">SAGAZ FARM OS</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 transition"
          aria-label="Alternar menu"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* SIDEBAR DESKTOP & MOBILE DRAWER */}
      <aside
        className={`
          fixed md:sticky top-0 z-40 h-screen w-64 bg-slate-900/95 backdrop-blur-md border-r border-slate-800 flex flex-col justify-between p-4 transition-transform duration-200 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div>
          {/* BRAND HEADER */}
          <div className="hidden md:flex items-center gap-3 px-2 py-3 mb-6 border-b border-slate-800/80">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-emerald-950/40">
              S
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white leading-tight">SAGAZ FARM OS</h1>
              <p className="text-xs text-emerald-400/90 font-medium">Soberania Operacional</p>
            </div>
          </div>

          {/* NAVIGATION LINKS */}
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`
                    w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                    ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-5 h-5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* PERSISTENCE STATUS BADGE */}
        <div className="pt-4 border-t border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-slate-200">IndexedDB Ativo</div>
              <div className="text-[10px] text-slate-400">Persistência Real Local</div>
            </div>
          </div>
        </div>
      </aside>

      {/* OVERLAY MOBILE */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
        />
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
};
