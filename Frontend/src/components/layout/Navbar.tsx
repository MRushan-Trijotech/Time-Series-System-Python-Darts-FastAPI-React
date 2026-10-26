import React from 'react'
import { Activity, Database, RefreshCw } from 'lucide-react'
import { useSession } from '../../contexts/SessionContext'

export const Navbar: React.FC = () => {
  const { filename, activeSheet, jobId, resetSession } = useSession()

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-xs">
          <Activity className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-slate-800 leading-tight">
            Smart Predict Studio
          </h1>
          <p className="text-xs text-slate-500">
            Automated Time-Series Forecasting
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {filename && (
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-full text-xs text-slate-600">
            <Database className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-medium text-slate-700 truncate max-w-[140px]">{filename}</span>
            {activeSheet && (
              <span className="text-slate-400">({activeSheet})</span>
            )}
          </div>
        )}

        {jobId && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            Job: {jobId.slice(0, 8)}
          </span>
        )}

        <button
          onClick={resetSession}
          className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-50 transition"
          title="Reset current session"
        >
          <RefreshCw className="w-3 h-3" />
          <span>New Session</span>
        </button>
      </div>
    </header>
  )
}

