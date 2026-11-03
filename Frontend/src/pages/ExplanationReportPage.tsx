import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  RotateCw,
  BarChart2,
  Loader2,
  Shield,
  Target,
  Calendar,
  Clock,
  Layers,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getExplanationReport } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { ExplanationReport } from '../types'

export const ExplanationReportPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId, forecastConfig } = useSession()

  const [report, setReport] = useState<ExplanationReport | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    const loadReport = async () => {
      setIsLoading(true)
      try {
        const data = await getExplanationReport(jobId)
        setReport(data)
      } catch (err: any) {
        setErrorMsg(err.response?.data?.detail || err.message || 'Failed to load explanation report.')
      } finally {
        setIsLoading(false)
      }
    }

    loadReport()
  }, [jobId, navigate])

  const activeConfig = useMemo(() => {
    if (forecastConfig) return forecastConfig
    if (report?.configuration) {
      const cfg = report.configuration
      return {
        hierarchyLevels: cfg.hierarchy_levels || (cfg.business_units?.length ? ['Business unit', 'SAC_Legal_Entity'] : []),
        hierarchySelections: cfg.hierarchy_summary || {},
        targetColumn: cfg.target_column || 'Target',
        businessUnits: cfg.business_units || [],
        buEntities: cfg.bu_entities || {},
        targetAccount: cfg.target_value || cfg.accounts?.[0] || null,
        targetLabel: cfg.target_description
          ? `${cfg.target_description} (${cfg.target_value || cfg.accounts?.[0]})`
          : cfg.target_value || cfg.accounts?.[0] || 'Target Account',
        trainStart: cfg.train_start || '',
        trainEnd: cfg.train_end || '',
        forecastHorizon: cfg.forecast_horizon || 12,
        totalObservations: cfg.total_observations,
      }
    }
    return null
  }, [forecastConfig, report])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Computing statistical diagnostics and pattern explanations...</p>
      </div>
    )
  }

  if (errorMsg || !report) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
        <h3 className="font-bold text-sm">Unable to render Explanation Report</h3>
        <p className="text-xs">{errorMsg || 'No explanation data returned.'}</p>
      </div>
    )
  }

  // ACF chart format
  const acfData = report.acf
    ? report.acf.lags.map((lag, i) => ({
        lag: `Lag ${lag}`,
        acf: report.acf?.acf_values[i] ?? 0,
      }))
    : []

  // Trend chart format
  const trendData = (report.trend?.values || []).map((pt) => ({
    date: pt.date.slice(0, 7),
    trend: pt.value,
  }))

  const trendYearStarts = trendData
    .filter((pt) => pt.date.endsWith('-01'))
    .map((pt) => pt.date)

  // Seasonality chart format
  const seasonalData = (report.seasonality?.values || []).map((pt) => ({
    date: pt.date.slice(0, 7),
    seasonal: pt.value,
  }))

  const seasonalYearStarts = seasonalData
    .filter((pt) => pt.date.endsWith('-01'))
    .map((pt) => pt.date)



  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
          Statistical Diagnostics
        </span>
        <h2 className="text-xl font-bold text-slate-800">Series Pattern & Explanation Report</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Mathematical decomposition of underlying trajectory, recurring seasonal cycles, and autocorrelation across lags.
        </p>
      </div>

      {/* Selected Configuration Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Target className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Analyzed Series Configuration
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-1">
          {/* Dynamic Hierarchy Levels */}
          {activeConfig?.hierarchyLevels && activeConfig.hierarchyLevels.length > 0 ? (
            activeConfig.hierarchyLevels.map((lvl) => {
              const selected = activeConfig.hierarchySelections?.[lvl] || []
              const displayVal =
                selected.length > 0
                  ? selected.length > 2
                    ? `${selected.slice(0, 2).join(', ')} (+${selected.length - 2})`
                    : selected.join(', ')
                  : `All ${lvl}`
              const fullVal = selected.length > 0 ? selected.join(', ') : `All ${lvl}`

              return (
                <div key={lvl} className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Layers className="w-3 h-3 text-blue-500" />
                    {lvl}
                  </span>
                  <p className="text-xs font-bold text-slate-800 truncate" title={fullVal}>
                    {displayVal}
                  </p>
                </div>
              )
            })
          ) : (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Layers className="w-3 h-3 text-blue-500" />
                Hierarchy Segments
              </span>
              <p className="text-xs font-bold text-slate-800 truncate">
                All Records
              </p>
            </div>
          )}

          {/* Forecasting Target */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3 text-emerald-500" />
              Target ({activeConfig?.targetColumn || 'Account'})
            </span>
            <p className="text-xs font-bold text-emerald-700 truncate" title={activeConfig?.targetLabel || activeConfig?.targetAccount || 'Target'}>
              {activeConfig?.targetLabel || activeConfig?.targetAccount || '—'}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-400" />
              Analyzed Period
            </span>
            <p className="text-xs font-bold text-slate-800">
              {activeConfig?.trainStart?.slice(0, 7) || 'Start'} → {activeConfig?.trainEnd?.slice(0, 7) || 'End'}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3 text-orange-500" />
              Forecast Horizon
            </span>
            <p className="text-xs font-bold text-orange-600">
              {activeConfig?.forecastHorizon || 12} Months
            </p>
          </div>
        </div>
      </div>

      {/* Diagnostics Grid: Trend and Seasonality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Trend Analysis
              </h4>
            </div>

            {report.trend && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ${
                  report.trend.direction === 'increasing'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : report.trend.direction === 'decreasing'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {report.trend.direction}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600">
            {report.trend?.description || 'Trend decomposition could not be computed for this series.'}
          </p>

          {trendData.length > 0 && (
            <div className="h-52 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(val: any) => Number(val).toLocaleString()}
                  />
                  <Tooltip
                    formatter={(value: any) => [Number(value).toLocaleString(), 'Estimated Trend']}
                  />

                  {/* Subtle grey vertical divider lines on January (Year Start) */}
                  {trendYearStarts.map((yr) => (
                    <ReferenceLine
                      key={yr}
                      x={yr}
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      label={{
                        value: yr.slice(0, 4),
                        fill: '#94a3b8',
                        fontSize: 9,
                        position: 'insideTopLeft',
                      }}
                    />
                  ))}

                  <Line
                    type="monotone"
                    dataKey="trend"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Seasonality Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-purple-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Seasonality Analysis
              </h4>
            </div>

            {report.seasonality && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  report.seasonality.detected
                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {report.seasonality.detected ? `Detected (Period: ${report.seasonality.period})` : 'Not Significant'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-600">
            {report.seasonality?.description || 'Seasonality test could not be evaluated.'}
          </p>

          {seasonalData.length > 0 ? (
            <div className="h-52 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={seasonalData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(val: any) => Number(val).toLocaleString()}
                  />
                  <Tooltip
                    formatter={(value: any) => [Number(value).toLocaleString(), 'Seasonal Component']}
                  />
                  <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />

                  {/* Subtle grey vertical divider lines on January (Year Start) */}
                  {seasonalYearStarts.map((yr) => (
                    <ReferenceLine
                      key={yr}
                      x={yr}
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                      label={{
                        value: yr.slice(0, 4),
                        fill: '#94a3b8',
                        fontSize: 9,
                        position: 'insideTopLeft',
                      }}
                    />
                  ))}

                  <Line
                    type="monotone"
                    dataKey="seasonal"
                    stroke="#9333ea"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center bg-slate-50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-400">
              No strong seasonal pattern to display.
            </div>
          )}
        </div>
      </div>

      {/* Autocorrelation Card */}
      {report.acf && acfData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-600" />
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Autocorrelation Function (ACF) Diagnostics
              </h4>
            </div>
            <span className="text-[11px] text-slate-400">Past target correlation across lags</span>
          </div>

          <p className="text-xs text-slate-600">
            {report.acf.description}
          </p>

          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={acfData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="lag" tick={{ fontSize: 10, fill: '#64748b' }} interval={1} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: '#64748b' }} />
                <ReferenceLine y={0} stroke="#64748b" />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="3 3" />
                <ReferenceLine y={-0.2} stroke="#94a3b8" strokeDasharray="3 3" />
                <Tooltip formatter={(value: any) => [Number(value).toFixed(3), 'ACF']} />
                <Bar dataKey="acf" fill="#0d9488" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Integrity & Methodology Notes */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3 text-xs text-slate-600">
        <div className="flex items-center gap-2 text-slate-800 font-semibold">
          <Shield className="w-4 h-4 text-blue-600" />
          <span>Diagnostic Methodology & Limitations</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-slate-500">
          {(report.limitations || []).map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
          <li>
            Decomposition and ACF diagnostics are purely descriptive and evaluate historical statistical patterns without asserting external causality.
          </li>
          <li>
            Zero actual values produce undefined percentage changes and are handled gracefully to preserve data integrity.
          </li>
        </ul>
      </div>
    </div>
  )
}
