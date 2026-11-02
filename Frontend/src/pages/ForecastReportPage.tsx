import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  Download,
  Calendar,
  Loader2,
  Building2,
  Briefcase,
  Target,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Percent,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getForecastReport } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { ForecastReport } from '../types'

// Format number with standard commas and 2 decimals: -11,881,901.94
function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '—'
  const isNegative = val < 0
  const absVal = Math.abs(val)
  const formatted = absVal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${isNegative ? '-' : ''}${formatted}`
}

function formatChangeValue(diff: number | null): { text: string; isPositive: boolean; isNegative: boolean } {
  if (diff === null || isNaN(diff)) return { text: '—', isPositive: false, isNegative: false }
  if (Math.abs(diff) < 0.005) return { text: '0.00', isPositive: false, isNegative: false }
  const isPos = diff > 0
  const formatted = Math.abs(diff).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return {
    text: `${isPos ? '+' : '-'}${formatted}`,
    isPositive: isPos,
    isNegative: !isPos,
  }
}

function formatChangePercent(curr: number, prev: number): { text: string; isPositive: boolean; isNegative: boolean } {
  if (prev === 0 || isNaN(prev) || isNaN(curr)) return { text: '—', isPositive: false, isNegative: false }
  const diff = curr - prev
  const pct = (diff / Math.abs(prev)) * 100
  if (Math.abs(pct) < 0.005) return { text: '0.00%', isPositive: false, isNegative: false }
  const isPos = pct > 0
  return {
    text: `${isPos ? '+' : ''}${pct.toFixed(2)}%`,
    isPositive: isPos,
    isNegative: !isPos,
  }
}

export const ForecastReportPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId, forecastConfig } = useSession()

  const [report, setReport] = useState<ForecastReport | null>(null)
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
        const data = await getForecastReport(jobId)
        setReport(data)
      } catch (err: any) {
        setErrorMsg(err.response?.data?.detail || err.message || 'Failed to load forecast report.')
      } finally {
        setIsLoading(false)
      }
    }

    loadReport()
  }, [jobId, navigate])

  // Extract configuration from report backend response or frontend session context
  const activeConfig = useMemo(() => {
    if (forecastConfig) return forecastConfig
    if (report?.configuration) {
      return {
        businessUnits: report.configuration.business_units || [],
        buEntities: report.configuration.bu_entities || {},
        targetAccount: report.configuration.accounts?.[0] || null,
        targetLabel: report.configuration.accounts?.[0] || 'Target Account',
        trainStart: report.configuration.train_start || '',
        trainEnd: report.configuration.train_end || '',
        forecastHorizon: report.configuration.forecast_horizon || report.forecast.length,
        totalObservations: report.configuration.total_observations,
      }
    }
    return null
  }, [forecastConfig, report])

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Loading Forecast Report...</p>
      </div>
    )
  }

  if (errorMsg || !report) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-2">
        <h3 className="font-bold text-sm">Unable to render Forecast Report</h3>
        <p className="text-xs">{errorMsg || 'No report data returned from backend.'}</p>
      </div>
    )
  }

  // Combine historical and future forecast into unified chart timeline
  const chartMap: Record<string, any> = {}

  report.historical.forEach((pt) => {
    chartMap[pt.date] = {
      date: pt.date.slice(0, 7),
      actual: pt.value,
      fullDate: pt.date,
    }
  })

  // CONNECT THE FORECAST LINE TO ACTUALS:
  // Set the forecast line's starting point at the last historical observation date so there is no gap!
  const lastHist = report.historical.length > 0 ? report.historical[report.historical.length - 1] : null
  const lastHistoricalDate = lastHist ? lastHist.date.slice(0, 7) : ''

  if (lastHist && chartMap[lastHist.date]) {
    chartMap[lastHist.date].futureForecast = lastHist.value
  }

  report.forecast.forEach((pt) => {
    if (!chartMap[pt.date]) {
      chartMap[pt.date] = { date: pt.date.slice(0, 7), fullDate: pt.date }
    }
    chartMap[pt.date].futureForecast = pt.value
  })

  const chartData = Object.values(chartMap).sort((a, b) => a.fullDate.localeCompare(b.fullDate))

  // Find all year starts (January) for subtle vertical dividing lines
  const yearStarts = chartData
    .filter((pt) => pt.date.endsWith('-01'))
    .map((pt) => pt.date)

  // Calculate table rows with Change and Change %
  const forecastTableRows = report.forecast.map((pt, idx) => {
    const period = pt.date.slice(0, 7)
    const val = pt.value ?? 0
    if (idx === 0) {
      return {
        period,
        value: val,
        changeVal: null,
        changePct: null,
      }
    }
    const prevVal = report.forecast[idx - 1].value ?? 0
    const diff = val - prevVal
    return {
      period,
      value: val,
      changeVal: diff,
      changePct: prevVal !== 0 ? (diff / Math.abs(prevVal)) * 100 : null,
      prevVal,
    }
  })

  // Format entities summary string
  const entitiesSummary = () => {
    if (!activeConfig?.buEntities || Object.keys(activeConfig.buEntities).length === 0) {
      return 'All Legal Entities'
    }
    const allEnts: string[] = []
    Object.entries(activeConfig.buEntities).forEach(([bu, ents]) => {
      if (ents && ents.length > 0) {
        ents.forEach((e) => allEnts.push(`${bu}:${e}`))
      }
    })
    return allEnts.length > 0 ? allEnts.join(', ') : 'All Legal Entities'
  }

  // Client-side CSV export matching the exact shown table
  const handleExportCSV = () => {
    const headers = ['Period', 'Forecasted Value', 'Change vs Previous Period', 'Change (%)']
    const rows = forecastTableRows.map((row) => {
      const changeVal = formatChangeValue(row.changeVal).text
      const changePct =
        row.changeVal !== null && row.prevVal !== undefined
          ? formatChangePercent(row.value, row.prevVal).text
          : '—'
      return [row.period, formatNumber(row.value), changeVal, changePct]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n')
    // Prepend UTF-8 BOM (\uFEFF) so Microsoft Excel correctly renders unicode characters without mojibake
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `forecast_${jobId?.slice(0, 8) || 'report'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const expectedMape =
    report.validation?.mape !== null && report.validation?.mape !== undefined
      ? `${report.validation.mape.toFixed(2)}%`
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Predictive Forecast Report
          </span>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">Forecast Trajectory & Analysis</h2>
            {expectedMape && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
                <Percent className="w-3 h-3 text-blue-500" />
                <span>Expected MAPE: {expectedMape}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Future trajectory and period-by-period predictive analysis based on historical patterns.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-2xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Forecast (CSV)</span>
          </button>
        </div>
      </div>

      {/* Selected Configuration Card (on top) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Target className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Applied Forecast Configuration
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 pt-1">
          {/* Business Unit */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Building2 className="w-3 h-3 text-blue-500" />
              Business Unit(s)
            </span>
            <p className="text-xs font-bold text-slate-800 truncate" title={activeConfig?.businessUnits?.join(', ') || 'All'}>
              {activeConfig?.businessUnits && activeConfig.businessUnits.length > 0
                ? activeConfig.businessUnits.join(', ')
                : 'All Business Units'}
            </p>
          </div>

          {/* Legal Entities */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Briefcase className="w-3 h-3 text-blue-500" />
              Legal Entities
            </span>
            <p className="text-xs font-bold text-slate-800 truncate" title={entitiesSummary()}>
              {entitiesSummary()}
            </p>
          </div>

          {/* Target */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3 text-emerald-500" />
              Forecasting Target
            </span>
            <p className="text-xs font-bold text-emerald-700 truncate" title={activeConfig?.targetLabel || activeConfig?.targetAccount || 'Target'}>
              {activeConfig?.targetLabel || activeConfig?.targetAccount || 'Sales Revenue (PL01)'}
            </p>
          </div>

          {/* Training Date Range */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-400" />
              Training Range
            </span>
            <p className="text-xs font-bold text-slate-800">
              {activeConfig?.trainStart?.slice(0, 7) || report.historical[0]?.date.slice(0, 7)} →{' '}
              {activeConfig?.trainEnd?.slice(0, 7) || lastHistoricalDate}
              <span className="text-[10px] font-normal text-slate-400 ml-1">
                ({report.historical.length} mo)
              </span>
            </p>
          </div>

          {/* Forecast Horizon */}
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3 text-orange-500" />
              Forecast Horizon
            </span>
            <p className="text-xs font-bold text-orange-600">
              {report.forecast.length} Months
              <span className="text-[10px] font-normal text-slate-400 ml-1">
                ({report.forecast[0]?.date.slice(0, 7)} → {report.forecast[report.forecast.length - 1]?.date.slice(0, 7)})
              </span>
            </p>
          </div>

          {/* Expected MAPE
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Percent className="w-3 h-3 text-blue-500" />
              Expected MAPE
            </span>
            <p className="text-xs font-bold text-blue-600">
              {expectedMape ?? 'N/A'}
              <span className="text-[10px] font-normal text-slate-400 ml-1">
                (Est. Error)
              </span>
            </p>
          </div> */}
        </div>
      </div>

      {/* Main Interactive Chart: Actual vs Future Forecast */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span>Historical Actuals & Future Forecast</span>
            </h3>
            <p className="text-xs text-slate-500">
              Blue line shows historical observations; orange line connects seamlessly to show future forecast trajectory.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-blue-600 inline-block" />
              <span className="text-slate-600 font-medium">Historical Actual</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-orange-500 inline-block" />
              <span className="text-slate-600 font-medium">Future Forecast</span>
            </div>
          </div>
        </div>

        <div className="h-96 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickFormatter={(val: any) => Number(val).toLocaleString()}
              />
              <Tooltip
                formatter={(value: any, name: any) => [
                  value !== null && value !== undefined ? formatNumber(value) : 'N/A',
                  name === 'actual' ? 'Historical Actual' : 'Future Forecast',
                ]}
                labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 10 }}
                formatter={(value: any) =>
                  value === 'actual' ? 'Historical Actual' : 'Future Forecast'
                }
              />

              {/* Subtle grey vertical divider lines on January (Year Start) */}
              {yearStarts.map((yr) => (
                <ReferenceLine
                  key={yr}
                  x={yr}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: yr.slice(0, 4),
                    fill: '#94a3b8',
                    fontSize: 10,
                    position: 'insideTopLeft',
                  }}
                />
              ))}

              {/* Forecast boundary line */}
              {lastHistoricalDate && (
                <ReferenceLine
                  x={lastHistoricalDate}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: 'Forecast Start',
                    fill: '#64748b',
                    fontSize: 10,
                    position: 'top',
                  }}
                />
              )}

              <Line
                type="monotone"
                dataKey="actual"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="futureForecast"
                stroke="#f97316"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Forecast Data Table (Full Width, with Change and Change %) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs space-y-0">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-orange-500" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Future Forecast Values & Period-Over-Period Trend
            </span>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {report.forecast.length} Future Periods
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 w-40">Period</th>
                <th className="px-6 py-3 text-right">Forecasted Value</th>
                <th className="px-6 py-3 text-right">Change vs Previous Period</th>
                <th className="px-6 py-3 text-right">Change (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-xs">
              {forecastTableRows.map((row, idx) => {
                const changeValInfo = formatChangeValue(row.changeVal)
                const changePctInfo =
                  row.changeVal !== null && row.prevVal !== undefined
                    ? formatChangePercent(row.value, row.prevVal)
                    : { text: '—', isPositive: false, isNegative: false }

                return (
                  <tr key={idx} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-3 font-sans font-semibold text-slate-800">
                      {row.period}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-slate-900">
                      {formatNumber(row.value)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {changeValInfo.text === '—' ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            changeValInfo.isPositive
                              ? 'text-emerald-600'
                              : changeValInfo.isNegative
                              ? 'text-rose-600'
                              : 'text-slate-500'
                          }`}
                        >
                          {changeValInfo.isPositive && <ArrowUpRight className="w-3.5 h-3.5" />}
                          {changeValInfo.isNegative && <ArrowDownRight className="w-3.5 h-3.5" />}
                          {!changeValInfo.isPositive && !changeValInfo.isNegative && <Minus className="w-3.5 h-3.5" />}
                          <span>{changeValInfo.text}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {changePctInfo.text === '—' ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            changePctInfo.isPositive
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : changePctInfo.isNegative
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {changePctInfo.text}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
