import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  Sliders,
  PlayCircle,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  Cpu,
  BarChart3,
} from 'lucide-react'

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="space-y-8">
      {/* Hero card */}
      <div className="bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 rounded-xl p-8 text-white shadow-sm flex justify-between items-center">
        <div className="space-y-3 max-w-2xl">
          <span className="inline-block px-3 py-1 bg-white/20 text-white rounded-full text-xs font-semibold tracking-wide uppercase">
            Inspired by SAP Analytics Cloud Smart Predict
          </span>
          <h2 className="text-3xl font-bold tracking-tight">
            Automated Time-Series Forecasting Studio
          </h2>
          <p className="text-blue-100 text-sm leading-relaxed">
            Upload complex multi-tier enterprise Excel workbooks, automatically detect split-row headers,
            evaluate multiple candidate forecasting models chronologically, and generate executive forecast
            and explanation reports.
          </p>
          <div className="pt-2">
            <button
              onClick={() => navigate('/upload')}
              className="px-5 py-2.5 bg-white text-blue-700 font-semibold rounded-lg hover:bg-blue-50 transition shadow-sm flex items-center gap-2 text-sm"
            >
              <span>Get Started & Upload Data</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 4-Step Process Cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-800">
          Guided Predictive Workflow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <UploadCloud className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-slate-800 text-sm">1. Smart Data Ingestion</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Handles multi-row and partially populated Excel headers (like SAP Story workbooks), detecting dimensions and monthly periods.
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-slate-800 text-sm">2. Filter & Horizon</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Filter by business unit, legal entity, or accounts. Configure chronological validation (75/25) and future horizon.
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <PlayCircle className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-slate-800 text-sm">3. Model Tournament</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Trains baseline, statistical (ARIMA, ETS, CES, Prophet), and ML models. Ranks candidates by finite validation MAPE.
            </p>
          </div>

          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-slate-800 text-sm">4. SAC-Style Reports</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Executive Forecast Report with actual vs. predicted curves, plus Explanation Report with trend, seasonality & ACF decomposition.
            </p>
          </div>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center gap-2.5 text-blue-600 font-medium text-sm">
            <Cpu className="w-4 h-4" />
            <span>Robust Darts Framework</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Preserves the exact forecasting pipeline from the source notebook, utilizing standard Darts metrics and model implementations.
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center gap-2.5 text-emerald-600 font-medium text-sm">
            <ShieldCheck className="w-4 h-4" />
            <span>Data Integrity & Zero Fabrications</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Missing values are preserved rather than replaced with zero. Only true mathematical metrics and diagnostics are exposed.
          </p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center gap-2.5 text-purple-600 font-medium text-sm">
            <BarChart3 className="w-4 h-4" />
            <span>Enterprise Visualizations</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Interactive charts with zoom, responsive tables, CSV export capabilities, and real-time training progress updates.
          </p>
        </div>
      </div>
    </div>
  )
}

