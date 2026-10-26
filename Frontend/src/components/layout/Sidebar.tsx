import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  UploadCloud,
  Sliders,
  PlayCircle,
  TrendingUp,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react'
import { useSession } from '../../contexts/SessionContext'

export const Sidebar: React.FC = () => {
  const { datasetId, transformData, jobId } = useSession()

  const navItems = [
    {
      to: '/',
      label: 'Overview',
      icon: LayoutDashboard,
      enabled: true,
      done: false,
    },
    {
      to: '/upload',
      label: '1. Upload Data',
      icon: UploadCloud,
      enabled: true,
      done: !!transformData,
    },
    {
      to: '/configure',
      label: '2. Configure Forecast',
      icon: Sliders,
      enabled: !!transformData,
      done: !!jobId,
    },
    {
      to: '/training',
      label: '3. Model Training',
      icon: PlayCircle,
      enabled: !!jobId,
      done: false,
    },
    {
      to: '/report/forecast',
      label: '4. Forecast Report',
      icon: TrendingUp,
      enabled: !!jobId,
      done: false,
    },
    {
      to: '/report/explanation',
      label: '5. Explanation Report',
      icon: HelpCircle,
      enabled: !!jobId,
      done: false,
    },
  ]

  return (
    <aside className="w-64 border-r border-slate-200 bg-white h-[calc(100vh-3.5rem)] flex flex-col justify-between p-4 sticky top-14 select-none">
      <div className="space-y-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3">
            Predictive Workflow
          </span>
          <nav className="mt-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              if (!item.enabled) {
                return (
                  <div
                    key={item.to}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-400 cursor-not-allowed opacity-60"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                )
              }

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }: { isActive: boolean }) =>
                    `flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.done && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {datasetId && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
            <span className="font-semibold text-slate-700 block">Dataset Status</span>
            <div className="text-slate-500 flex justify-between">
              <span>Rows transformed:</span>
              <span className="font-medium text-slate-800">{transformData?.row_count ?? 0}</span>
            </div>
            <div className="text-slate-500 flex justify-between">
              <span>Time horizon:</span>
              <span className="font-medium text-slate-800">{transformData?.period_columns.length ?? 0} months</span>
            </div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-slate-400 px-3 border-t border-slate-100 pt-3">
        SAP Smart Predict Architecture v1.0
      </div>
    </aside>
  )
}
