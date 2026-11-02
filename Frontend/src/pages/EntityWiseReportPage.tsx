import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download,
  Calendar,
  Building2,
  Briefcase,
  Target,
  Clock,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  FileSpreadsheet,
} from 'lucide-react'
import { API_BASE_URL, getEntityWiseReport } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { EntityWiseReportResponse } from '../types'

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

export const EntityWiseReportPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId, forecastConfig, setEntityStatus } = useSession()

  const [reportData, setReportData] = useState<EntityWiseReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Filters & Hierarchy Controls
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedBUs, setExpandedBUs] = useState<Record<string, boolean>>({})

  // Poller for entity-wise training completion
  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    let isMounted = true
    let pollTimer: any = null

    const fetchStatus = async () => {
      try {
        const resp = await getEntityWiseReport(jobId)
        if (!isMounted) return
        setReportData(resp)
        if (resp.status) {
          setEntityStatus(resp.status)
        }

        if (resp.status === 'completed') {
          setIsLoading(false)
          // Default all BUs to expanded
          if (resp.data) {
            const initialBUs: Record<string, boolean> = {}
            if (resp.data.entity_forecasts) {
              resp.data.entity_forecasts.forEach((e) => {
                initialBUs[e.business_unit] = true
              })
            } else if (resp.data.hierarchy?.[0]?.business_units) {
              resp.data.hierarchy[0].business_units.forEach((b) => {
                initialBUs[b.business_unit] = true
              })
            }
            setExpandedBUs(initialBUs)
          }
        } else if (resp.status === 'failed') {
          setIsLoading(false)
          setErrorMsg(resp.error || 'Entity-wise training failed.')
        } else {
          // 'pending' or 'running' -> keep polling
          pollTimer = setTimeout(fetchStatus, 1500)
        }
      } catch (err: any) {
        if (!isMounted) return
        setErrorMsg(err.response?.data?.detail || err.message || 'Failed to fetch entity-wise report.')
        setIsLoading(false)
      }
    }

    fetchStatus()

    return () => {
      isMounted = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [jobId, navigate, setEntityStatus])

  // Pivot data so Rows = BU -> Entity, Columns = Months
  const tableData = useMemo(() => {
    if (!reportData?.data) return null
    const { months, hierarchy, entity_forecasts } = reportData.data

    const buMap: Record<
      string,
      {
        business_unit: string
        total: number
        months: Record<string, number>
        entities: Array<{
          entity: string
          total: number
          months: Record<string, number>
        }>
      }
    > = {}

    if (entity_forecasts && entity_forecasts.length > 0) {
      entity_forecasts.forEach((item) => {
        const bu = item.business_unit
        if (!buMap[bu]) {
          buMap[bu] = {
            business_unit: bu,
            total: 0,
            months: {},
            entities: [],
          }
          months.forEach((m) => {
            buMap[bu].months[m] = 0
          })
        }

        const entMonths: Record<string, number> = {}
        let entTotal = 0
        months.forEach((m) => {
          const val = item.forecast?.[m] ?? 0
          entMonths[m] = val
          entTotal += val
          buMap[bu].months[m] += val
          buMap[bu].total += val
        })

        buMap[bu].entities.push({
          entity: item.entity,
          total: entTotal,
          months: entMonths,
        })
      })
    } else if (hierarchy && hierarchy.length > 0) {
      // Reconstruct from hierarchy if entity_forecasts is absent
      const entityLookup: Record<string, Record<string, Record<string, number>>> = {}

      hierarchy.forEach((mNode) => {
        const m = mNode.month
        mNode.business_units.forEach((bNode) => {
          const bu = bNode.business_unit
          if (!buMap[bu]) {
            buMap[bu] = {
              business_unit: bu,
              total: 0,
              months: {},
              entities: [],
            }
            months.forEach((mo) => {
              buMap[bu].months[mo] = 0
            })
            entityLookup[bu] = {}
          }
          buMap[bu].months[m] = (buMap[bu].months[m] || 0) + (bNode.forecast || 0)
          buMap[bu].total += bNode.forecast || 0

          bNode.entities.forEach((eNode) => {
            const ent = eNode.entity
            if (!entityLookup[bu][ent]) {
              entityLookup[bu][ent] = {}
            }
            entityLookup[bu][ent][m] = eNode.forecast || 0
          })
        })
      })

      Object.keys(buMap).forEach((bu) => {
        Object.entries(entityLookup[bu] || {}).forEach(([ent, mValues]) => {
          let entTotal = 0
          months.forEach((m) => {
            entTotal += mValues[m] || 0
          })
          buMap[bu].entities.push({
            entity: ent,
            total: entTotal,
            months: mValues,
          })
        })
      })
    }

    const grandMonths: Record<string, number> = {}
    let grandTotal = 0
    months.forEach((m) => {
      grandMonths[m] = 0
      Object.values(buMap).forEach((b) => {
        grandMonths[m] += b.months[m] || 0
      })
      grandTotal += grandMonths[m]
    })

    const sortedBUs = Object.values(buMap).sort((a, b) =>
      a.business_unit.localeCompare(b.business_unit)
    )
    sortedBUs.forEach((b) => {
      b.entities.sort((e1, e2) => e1.entity.localeCompare(e2.entity))
    })

    return {
      months,
      bus: sortedBUs,
      grandTotal,
      grandMonths,
    }
  }, [reportData])

  // Filtered BUs based on search query
  const filteredBUs = useMemo(() => {
    if (!tableData) return []
    if (!searchQuery.trim()) return tableData.bus

    const q = searchQuery.toLowerCase().trim()
    return tableData.bus
      .map((b) => {
        const buMatches = b.business_unit.toLowerCase().includes(q)
        const matchedEntities = b.entities.filter((e) => e.entity.toLowerCase().includes(q))
        if (buMatches || matchedEntities.length > 0) {
          return {
            ...b,
            entities: matchedEntities.length > 0 ? matchedEntities : b.entities,
          }
        }
        return null
      })
      .filter(Boolean) as typeof tableData.bus
  }, [tableData, searchQuery])

  // Toggle BU collapse
  const toggleBU = (bu: string) => {
    setExpandedBUs((prev) => ({ ...prev, [bu]: !prev[bu] }))
  }

  // Expand all: set all BUs to true
  const handleExpandAll = () => {
    if (!tableData) return
    const allB: Record<string, boolean> = {}
    tableData.bus.forEach((b) => {
      allB[b.business_unit] = true
    })
    setExpandedBUs(allB)
  }

  // Collapse all: clear state so all BU rows collapse cleanly
  const handleCollapseAll = () => {
    setExpandedBUs({})
  }

  // Download Story-style export (.xlsx or .csv)
  const handleExportDownload = (extension: 'xlsx' | 'csv') => {
    if (!jobId) return
    const link = document.createElement('a')
    link.href = `${API_BASE_URL}/reports/${jobId}/export/entity-wise.${extension}`
    link.download = `entity_wise_forecast_${jobId.slice(0, 8)}.${extension}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── Render Pending / Running State Screen ──────────────────────────────────
  if (reportData?.status === 'pending' || reportData?.status === 'running' || isLoading) {
    const progress = reportData?.progress
    const percent = progress?.percent ?? 0
    const currentSegment = progress?.current_segment || 'Preparing segments...'
    const completed = progress?.completed ?? 0
    const total = progress?.total ?? 1

    return (
      <div className="max-w-3xl mx-auto py-12 px-4 space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-2xs">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>Background Training in Progress</span>
            </span>
            <h2 className="text-xl font-bold text-slate-800">
              Entity-wise Model Training in Progress
            </h2>
            <p className="text-xs text-slate-500 max-w-lg mx-auto">
              Candidate models are being independently trained across each selected Business Unit
              and Legal Entity in the background. The full hierarchy report will automatically unlock
              once all segments complete.
            </p>
          </div>

          {/* Progress Bar & Counter */}
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-600">
              <span className="truncate max-w-[240px] text-left text-slate-700">
                {currentSegment}
              </span>
              <span className="font-mono text-amber-600">
                {completed} / {total} segments ({percent.toFixed(0)}%)
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-amber-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, percent))}%` }}
              />
            </div>
          </div>

          {/* Helpful Navigation Note */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/report/forecast')}
              className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold flex items-center gap-2 transition"
            >
              <TrendingUp className="w-4 h-4" />
              <span>View Total Forecast Report</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render Error State ─────────────────────────────────────────────────────
  if (errorMsg || reportData?.status === 'failed' || !reportData?.data || !tableData) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-rose-600" />
          <h3 className="font-bold text-sm">Entity-wise Report Unavailable</h3>
        </div>
        <p className="text-xs text-rose-700">{errorMsg || reportData?.error || 'Unable to load segment results.'}</p>
        <button
          type="button"
          onClick={() => navigate('/configure')}
          className="px-3.5 py-1.5 bg-white border border-rose-300 text-rose-800 rounded-lg text-xs font-semibold hover:bg-rose-100"
        >
          Return to Configuration
        </button>
      </div>
    )
  }

  const { months } = tableData

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
            Hierarchical Segment Matrix
          </span>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">Entity-wise Forecast Table</h2>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              <span>{reportData.data.total_segments} Entities Trained</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Forecasted values across future periods for each Business Unit and Legal Entity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExportDownload('xlsx')}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-2xs cursor-pointer"
            title="Download in Story.xlsx hierarchy format"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Story (Excel)</span>
          </button>
          <button
            type="button"
            onClick={() => handleExportDownload('csv')}
            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-2 transition shadow-2xs cursor-pointer"
            title="Download in Story hierarchy CSV format"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Story (CSV)</span>
          </button>
        </div>
      </div>

      {/* Top Configuration & Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar className="w-3 h-3 text-blue-500" />
            Forecast Horizon
          </span>
          <p className="text-base font-bold text-slate-800">{months.length} Months</p>
          <span className="text-[10px] text-slate-400 block truncate">
            {months[0]} → {months[months.length - 1]}
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Building2 className="w-3 h-3 text-purple-500" />
            Business Units
          </span>
          <p className="text-base font-bold text-slate-800">{reportData.data.total_business_units}</p>
          <span className="text-[10px] text-slate-400 block">Trained & Aggregated</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Briefcase className="w-3 h-3 text-emerald-500" />
            Legal Entities
          </span>
          <p className="text-base font-bold text-slate-800">{reportData.data.total_segments}</p>
          <span className="text-[10px] text-slate-400 block">Independently Trained</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Target className="w-3 h-3 text-amber-500" />
            Forecasting Target
          </span>
          <p className="text-base font-bold text-emerald-700 truncate" title={forecastConfig?.targetLabel || 'Target'}>
            {forecastConfig?.targetLabel || forecastConfig?.targetAccount || 'Primary Account'}
          </p>
          <span className="text-[10px] text-slate-400 block">Reconciled Target</span>
        </div>
      </div>

      {/* Toolbar: Search & Expand/Collapse */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search Business Unit, Entity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          />
        </div>

        {/* Expand / Collapse All */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExpandAll}
            className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold transition cursor-pointer"
          >
            Expand All BUs
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="px-2.5 py-1 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold transition cursor-pointer"
          >
            Collapse All BUs
          </button>
        </div>
      </div>

      {/* Hierarchical Entity-wise Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 select-none">
              <tr>
                {/* Pinned Left Hierarchy Header */}
                <th className="px-5 py-3.5 min-w-[280px] sticky left-0 bg-slate-50 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                  Business Unit / Legal Entity Hierarchy
                </th>
                {/* Total Column */}
                <th className="px-4 py-3.5 text-right min-w-[130px] font-bold text-slate-800 bg-slate-100/60">
                  Total
                </th>
                {/* Month Columns */}
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-4 py-3.5 text-right min-w-[120px] font-mono font-bold text-slate-700 whitespace-nowrap"
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* GRAND TOTAL ROW */}
              <tr className="bg-blue-50/60 font-bold border-b-2 border-slate-200">
                <td className="px-5 py-3 text-blue-950 sticky left-0 bg-blue-50/90 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-xs font-bold">
                      <Target className="w-3.5 h-3.5 text-blue-600" />
                      All Business Units
                    </span>
                    <span className="text-[11px] font-normal text-slate-500">
                      (Grand Total)
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-blue-950 bg-blue-100/40">
                  {formatNumber(tableData.grandTotal)}
                </td>
                {months.map((m) => (
                  <td key={m} className="px-4 py-3 text-right font-mono text-blue-950">
                    {formatNumber(tableData.grandMonths[m])}
                  </td>
                ))}
              </tr>

              {/* BUSINESS UNITS & ENTITIES */}
              {filteredBUs.map((buNode) => {
                const isExpanded = Boolean(expandedBUs[buNode.business_unit])

                return (
                  <React.Fragment key={buNode.business_unit}>
                    {/* LEVEL 1: BUSINESS UNIT ROW */}
                    <tr
                      onClick={() => toggleBU(buNode.business_unit)}
                      className="bg-slate-50/80 hover:bg-slate-100/80 transition cursor-pointer font-semibold border-t border-slate-200"
                    >
                      <td className="px-5 py-2.5 text-slate-900 sticky left-0 bg-slate-50/95 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-slate-200 text-slate-500"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-purple-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-purple-600" />
                            )}
                          </button>
                          <Building2 className="w-3.5 h-3.5 text-purple-600" />
                          <span className="font-bold text-slate-900">
                            BU {buNode.business_unit}
                          </span>
                          <span className="text-[10px] font-normal text-slate-400">
                            ({buNode.entities.length} entities)
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-purple-950 bg-purple-50/30">
                        {formatNumber(buNode.total)}
                      </td>
                      {months.map((m) => (
                        <td
                          key={m}
                          className="px-4 py-2.5 text-right font-mono font-bold text-slate-800"
                        >
                          {formatNumber(buNode.months[m])}
                        </td>
                      ))}
                    </tr>

                    {/* LEVEL 2: LEGAL ENTITIES (SHOWN WHEN BU IS EXPANDED) */}
                    {isExpanded &&
                      buNode.entities.map((entNode) => (
                        <tr
                          key={`${buNode.business_unit}-${entNode.entity}`}
                          className="bg-white hover:bg-emerald-50/30 transition"
                        >
                          <td className="px-5 py-2 pl-12 text-slate-700 sticky left-0 bg-white hover:bg-emerald-50/30 z-10 shadow-[1px_0_0_0_#e2e8f0]">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                              <Briefcase className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="font-medium text-slate-800">
                                Entity {entNode.entity}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 bg-slate-50/40">
                            {formatNumber(entNode.total)}
                          </td>
                          {months.map((m) => (
                            <td
                              key={m}
                              className="px-4 py-2 text-right font-mono text-slate-700"
                            >
                              {formatNumber(entNode.months[m])}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
