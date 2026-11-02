import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar,
  Play,
  AlertCircle,
  Loader2,
  Building2,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  Target,
  Circle,
  CircleDot,
  Info,
  TrendingUp,
} from 'lucide-react'
import { getDimensions, getSeriesInfo, startTraining } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { AccountItem, DimensionValue } from '../types'

export const ConfigurationPage: React.FC = () => {
  const navigate = useNavigate()
  const { datasetId, transformData, setJobId, setForecastConfig } = useSession()

  const [dimensions, setDimensions] = useState<DimensionValue[]>([])
  const [buHierarchy, setBuHierarchy] = useState<Record<string, string[]>>({})
  const [accountsList, setAccountsList] = useState<AccountItem[]>([])
  const [relationsList, setRelationsList] = useState<Record<string, string>[]>([])

  // Selected filters
  const [selectedBUs, setSelectedBUs] = useState<string[]>([])
  const [buEntities, setBuEntities] = useState<Record<string, string[]>>({})
  const [selectedTargetAccount, setSelectedTargetAccount] = useState<string | null>(null)
  const [otherFilters, setOtherFilters] = useState<Record<string, string[]>>({})

  // UI state
  const [buSearch, setBuSearch] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [expandedBUs, setExpandedBUs] = useState<Record<string, boolean>>({})

  // Series info (loaded reactively when selection changes)
  const [seriesInfo, setSeriesInfo] = useState<{
    n_observations: number
    date_range_start: string
    date_range_end: string
    recommended_horizon: number
    warnings: string[]
  } | null>(null)
  const [seriesInfoLoading, setSeriesInfoLoading] = useState(false)

  // Training date range
  const [trainStart, setTrainStart] = useState<string>('')
  const [trainEnd, setTrainEnd] = useState<string>('')

  // Forecast horizon (dropdown 1-100, pre-selected from recommendation)
  const [forecastHorizon, setForecastHorizon] = useState<number>(12)

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!datasetId || !transformData) {
      navigate('/upload')
      return
    }

    const loadConfig = async () => {
      setIsLoading(true)
      try {
        const dimRes = await getDimensions(datasetId)
        setDimensions(dimRes.dimensions)
        setBuHierarchy(dimRes.bu_entity_hierarchy || {})
        const accs = dimRes.accounts || []
        setAccountsList(accs)
        setRelationsList(dimRes.relations || [])

        // Default to Sales Revenue (PL01) if present
        const defaultTarget =
          accs.find(
            (a) =>
              a.account.toUpperCase() === 'PL01' ||
              a.description.toLowerCase().includes('sales revenue')
          )?.account || (accs[0]?.account ?? null)
        setSelectedTargetAccount(defaultTarget)

        const initialOther: Record<string, string[]> = {}
        dimRes.dimensions.forEach((d) => {
          const lName = d.name.toLowerCase()
          if (
            !lName.includes('business unit') &&
            !lName.includes('legal_entity') &&
            !lName.includes('legal entity') &&
            lName !== 'account' &&
            lName !== 'description'
          ) {
            initialOther[d.name] = []
          }
        })
        setOtherFilters(initialOther)
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to load configuration parameters.')
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [datasetId, transformData, navigate])

  // All Business Units from hierarchy
  const allBUs = useMemo(() => {
    if (Object.keys(buHierarchy).length > 0) return Object.keys(buHierarchy).sort()
    const buDim = dimensions.find((d) => d.name.toLowerCase().includes('business unit'))
    return buDim ? buDim.values : []
  }, [buHierarchy, dimensions])

  const visibleBUs = useMemo(() => {
    if (!buSearch) return allBUs
    return allBUs.filter((bu) => bu.toLowerCase().includes(buSearch.toLowerCase()))
  }, [allBUs, buSearch])

  // Toggle a Business Unit
  const toggleBU = (bu: string) => {
    setSelectedBUs((prev) => {
      if (prev.includes(bu)) {
        const next = prev.filter((b) => b !== bu)
        const nextEntities = { ...buEntities }
        delete nextEntities[bu]
        setBuEntities(nextEntities)
        return next
      } else {
        setExpandedBUs((exp) => ({ ...exp, [bu]: true }))
        return [...prev, bu]
      }
    })
  }

  const selectAllBUs = () => setSelectedBUs([...allBUs])
  const clearAllBUs = () => {
    setSelectedBUs([])
    setBuEntities({})
  }

  const toggleEntityForBU = (bu: string, entity: string) => {
    setBuEntities((prev) => {
      const current = prev[bu] || []
      const updated = current.includes(entity)
        ? current.filter((e) => e !== entity)
        : [...current, entity]
      return { ...prev, [bu]: updated }
    })
  }

  const selectAllEntitiesForBU = (bu: string) => {
    const allForBU = buHierarchy[bu] || []
    setBuEntities((prev) => ({ ...prev, [bu]: [...allForBU] }))
  }

  const clearEntitiesForBU = (bu: string) => {
    setBuEntities((prev) => ({ ...prev, [bu]: [] }))
  }

  // Accounts available for selection based on selected BU and Legal Entities
  const availableAccounts = useMemo(() => {
    if (accountsList.length === 0) return []
    if (selectedBUs.length === 0 || relationsList.length === 0) return accountsList
    const validAccSet = new Set<string>()
    relationsList.forEach((rel) => {
      const bu = rel.bu
      const ent = rel.entity
      const acc = rel.account
      if (!acc) return
      if (selectedBUs.includes(bu)) {
        const selectedEntsForThisBU = buEntities[bu] || []
        if (selectedEntsForThisBU.length === 0 || selectedEntsForThisBU.includes(ent)) {
          validAccSet.add(acc)
        }
      }
    })
    return accountsList.filter((a) => validAccSet.has(a.account))
  }, [accountsList, relationsList, selectedBUs, buEntities])

  // Synchronize target selection if available accounts change
  useEffect(() => {
    if (availableAccounts.length > 0) {
      const currentValid = availableAccounts.some((a) => a.account === selectedTargetAccount)
      if (!currentValid) {
        const sales = availableAccounts.find(
          (a) =>
            a.account.toUpperCase() === 'PL01' ||
            a.description.toLowerCase().includes('sales revenue')
        )
        setSelectedTargetAccount(sales ? sales.account : availableAccounts[0].account)
      }
    } else {
      setSelectedTargetAccount(null)
    }
  }, [availableAccounts, selectedTargetAccount])

  // Visible accounts: filter by search, and pin Sales Revenue / currently selected to the top!
  const visibleAccounts = useMemo(() => {
    let list = [...availableAccounts]
    if (accountSearch.trim()) {
      const q = accountSearch.toLowerCase()
      list = list.filter(
        (a) =>
          a.account.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.label.toLowerCase().includes(q)
      )
    }

    // Sorting:
    // 1. Selected target always at the very top!
    // 2. Sales Revenue (PL01) next
    // 3. Other accounts alphabetically
    list.sort((a, b) => {
      const aIsSelected = a.account === selectedTargetAccount
      const bIsSelected = b.account === selectedTargetAccount
      if (aIsSelected && !bIsSelected) return -1
      if (!aIsSelected && bIsSelected) return 1

      const aIsSales =
        a.account.toUpperCase() === 'PL01' ||
        a.description.toLowerCase().includes('sales revenue')
      const bIsSales =
        b.account.toUpperCase() === 'PL01' ||
        b.description.toLowerCase().includes('sales revenue')
      if (aIsSales && !bIsSales) return -1
      if (!aIsSales && bIsSales) return 1

      return a.label.localeCompare(b.label)
    })

    return list
  }, [availableAccounts, accountSearch, selectedTargetAccount])

  // --- Fetch series info from backend with strict starting month checking ---
  const fetchSeriesInfo = useCallback(async () => {
    if (!datasetId || !selectedTargetAccount) {
      setSeriesInfo(null)
      return
    }
    setSeriesInfoLoading(true)
    try {
      const payloadBUEntities: Record<string, string[]> = {}
      selectedBUs.forEach((bu) => {
        payloadBUEntities[bu] = buEntities[bu] || []
      })

      const info = await getSeriesInfo(datasetId, {
        bu_entities: selectedBUs.length > 0 ? payloadBUEntities : undefined,
        accounts: [selectedTargetAccount],
        filters: otherFilters,
      })
      setSeriesInfo(info)
      // Set training range defaults to the actual observed bounds
      setTrainStart(info.date_range_start)
      setTrainEnd(info.date_range_end)
    } catch {
      setSeriesInfo(null)
    } finally {
      setSeriesInfoLoading(false)
    }
  }, [datasetId, selectedBUs, buEntities, selectedTargetAccount, otherFilters])

  useEffect(() => {
    fetchSeriesInfo()
  }, [fetchSeriesInfo])

  // Compute filtered observation count based on trainStart / trainEnd selection
  const filteredObsCount = useMemo(() => {
    if (!seriesInfo || !trainStart || !trainEnd) return seriesInfo?.n_observations || 0
    if (!seriesInfo.date_range_start || !seriesInfo.date_range_end) return 0
    const startMs = new Date(trainStart).getTime()
    const endMs = new Date(trainEnd).getTime()
    const seriesStartMs = new Date(seriesInfo.date_range_start).getTime()
    const seriesEndMs = new Date(seriesInfo.date_range_end).getTime()
    if (startMs > endMs) return 0
    // Count months in [trainStart, trainEnd] that overlap with [seriesStart, seriesEnd]
    const effStart = Math.max(startMs, seriesStartMs)
    const effEnd = Math.min(endMs, seriesEndMs)
    if (effStart > effEnd) return 0
    const s = new Date(effStart)
    const e = new Date(effEnd)
    return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1
  }, [seriesInfo, trainStart, trainEnd])

  // Dynamically calculate recommended horizon based on current filteredObsCount
  // Rule: if 36 months -> 6; otherwise 4:1 ratio (floor(n / 4)), min 1, max 36
  const recommendedHorizon = useMemo(() => {
    if (filteredObsCount <= 0) return 0
    if (filteredObsCount === 36) return 6
    return Math.max(1, Math.min(36, Math.floor(filteredObsCount / 4)))
  }, [filteredObsCount])

  // Automatically update forecastHorizon to the recommended horizon whenever it changes
  useEffect(() => {
    if (recommendedHorizon > 0) {
      setForecastHorizon(recommendedHorizon)
    }
  }, [recommendedHorizon])

  const hasEnoughData = filteredObsCount >= 12
  const horizonOptions = Array.from({ length: 100 }, (_, i) => i + 1)

  const handleStartTraining = async () => {
    if (!datasetId) return
    if (!selectedTargetAccount) {
      setErrorMsg('Please select a Forecasting Target account to proceed.')
      return
    }
    if (!hasEnoughData) {
      setErrorMsg(
        `At least 12 months of training data are required. Current selection: ${filteredObsCount} month(s).`
      )
      return
    }

    setIsSubmitting(true)
    setErrorMsg(null)
    try {
      const payloadBUEntities: Record<string, string[]> = {}
      selectedBUs.forEach((bu) => {
        payloadBUEntities[bu] = buEntities[bu] || []
      })

      setForecastConfig({
        businessUnits: selectedBUs,
        buEntities: payloadBUEntities,
        targetAccount: selectedTargetAccount,
        targetLabel:
          accountsList.find((a) => a.account === selectedTargetAccount)?.label ||
          selectedTargetAccount,
        trainStart: trainStart || seriesInfo?.date_range_start || '',
        trainEnd: trainEnd || seriesInfo?.date_range_end || '',
        forecastHorizon: forecastHorizon,
        totalObservations: filteredObsCount,
      })

      const res = await startTraining({
        dataset_id: datasetId,
        bu_entities: selectedBUs.length > 0 ? payloadBUEntities : undefined,
        accounts: [selectedTargetAccount],
        filters: otherFilters,
        forecast_horizon: forecastHorizon,
        validation_split: 0.75,
        train_start: trainStart || undefined,
        train_end: trainEnd || undefined,
      })
      setJobId(res.job_id)
      navigate('/training')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Failed to submit training job.')
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Loading dimension hierarchy...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Forecast Configuration</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select business units, legal entities, and a forecasting target to build your series.
          </p>
        </div>

        <button
          onClick={handleStartTraining}
          disabled={isSubmitting || !selectedTargetAccount || !hasEnoughData}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Launching Tournament...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Train and Forecast</span>
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Hierarchical Filters + Target */}
        <div className="lg:col-span-2 space-y-6">
          {/* SECTION 1: Business Unit & Hierarchical SAC Legal Entity */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  1. Business Unit & Hierarchical Legal Entity
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={selectAllBUs}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={clearAllBUs}
                  className="text-slate-500 hover:underline"
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Business Unit Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Select Business Unit(s):
                </label>
                <span className="text-[11px] text-slate-400">
                  {selectedBUs.length > 0
                    ? `${selectedBUs.length} selected`
                    : 'All included by default'}
                </span>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter business units (e.g. 7B, 7A01)..."
                  value={buSearch}
                  onChange={(e) => setBuSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pt-1 pr-1">
                {visibleBUs.map((bu) => {
                  const isChecked = selectedBUs.includes(bu)
                  return (
                    <button
                      key={bu}
                      type="button"
                      onClick={() => toggleBU(bu)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                        isChecked
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3" />}
                      <span>{bu}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Hierarchical SAC Legal Entity */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                  <span>Available SAC Legal Entities for Selected Business Units:</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  Option to choose separate SAC entity per Business Unit
                </span>
              </div>

              {selectedBUs.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 text-center">
                  All Business Units and their respective Legal Entities are currently included. Select any Business Unit above to customize individual legal entities.
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {selectedBUs.map((bu) => {
                    const availableEntities = buHierarchy[bu] || []
                    const selectedForThisBU = buEntities[bu] || []
                    const isExpanded = expandedBUs[bu] ?? true

                    return (
                      <div
                        key={bu}
                        className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-2xs"
                      >
                        <div
                          className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none"
                          onClick={() =>
                            setExpandedBUs((exp) => ({ ...exp, [bu]: !isExpanded }))
                          }
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600" />
                            <span className="text-xs font-bold text-slate-800">
                              Business Unit: {bu}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">
                              {selectedForThisBU.length > 0
                                ? `${selectedForThisBU.length} / ${availableEntities.length} entities`
                                : `All ${availableEntities.length} entities`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                selectAllEntitiesForBU(bu)
                              }}
                              className="text-[11px] text-blue-600 hover:underline font-medium"
                            >
                              All
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                clearEntitiesForBU(bu)
                              }}
                              className="text-[11px] text-slate-500 hover:underline"
                            >
                              Reset
                            </button>
                            <button
                              type="button"
                              className="text-slate-400 hover:text-slate-600 ml-1"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="p-3 bg-white">
                            {availableEntities.length === 0 ? (
                              <span className="text-xs text-slate-400 italic">
                                No distinct legal entities found for {bu}.
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {availableEntities.map((ent) => {
                                  const isSelected =
                                    selectedForThisBU.length === 0 ||
                                    selectedForThisBU.includes(ent)
                                  return (
                                    <button
                                      key={ent}
                                      type="button"
                                      onClick={() => toggleEntityForBU(bu, ent)}
                                      className={`px-2.5 py-1 rounded text-xs font-medium transition flex items-center gap-1 border ${
                                        selectedForThisBU.includes(ent)
                                          ? 'bg-blue-600 text-white border-blue-600'
                                          : isSelected && selectedForThisBU.length === 0
                                          ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      <span>Entity {ent}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* SECTION 2: Forecasting Target (Single Selection, Sales Revenue pinned to top, No filter tabs) */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  2. Forecasting Target
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                  Single Select
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {selectedTargetAccount ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTargetAccount(null)}
                    className="text-slate-500 hover:text-slate-800 hover:underline text-[11px]"
                  >
                    Clear Target
                  </button>
                ) : (
                  <span className="text-amber-600 font-medium text-[11px]">
                    Select 1 Target
                  </span>
                )}
              </div>
            </div>

            {/* Clean full-width search bar without filter buttons */}
            <div className="relative w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search account code or description (e.g. Sales Revenue, PL01, Domestic)..."
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* Account List: Sales Revenue / selected target pinned at the top */}
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {visibleAccounts.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 italic">
                  No accounts found matching your search and entity selection.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {visibleAccounts.map((acc) => {
                    const isSelected = selectedTargetAccount === acc.account
                    return (
                      <div
                        key={acc.account}
                        onClick={() =>
                          setSelectedTargetAccount((prev) =>
                            prev === acc.account ? null : acc.account
                          )
                        }
                        className={`p-2.5 rounded-lg text-xs cursor-pointer transition flex items-center justify-between border ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500 text-slate-900 font-semibold shadow-xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isSelected ? (
                            <CircleDot className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <span className="block truncate font-medium">
                              {acc.description || acc.account}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-mono">
                              Code: {acc.account}
                            </span>
                          </div>
                        </div>
                        {/* {isPL && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ml-1 ${
                              isSelected
                                ? 'bg-emerald-200 text-emerald-900'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            P&L
                          </span>
                        )} */}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-500 pt-1.5 border-t border-slate-100">
              <span className="flex items-center gap-1.5 font-medium text-slate-700">
                <Target className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                {selectedTargetAccount ? (
                  <span>
                    Selected Target:{' '}
                    <span className="font-bold text-emerald-700">
                      {accountsList.find((a) => a.account === selectedTargetAccount)?.label ||
                        selectedTargetAccount}
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-600 font-medium">
                    Please select one forecasting target
                  </span>
                )}
              </span>
              <span className="text-slate-400 text-[10px] italic">
                Only one target is selected at a time to prevent double-counting summary hierarchies.
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Series Info + Training Range + Dynamic Horizon */}
        <div className="space-y-6">
          {/* Series Info Panel */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              Series Information
            </span>

            {seriesInfoLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-slate-500 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span>Checking available history...</span>
              </div>
            ) : seriesInfo && seriesInfo.n_observations > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wide">
                      Available Start
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {new Date(seriesInfo.date_range_start).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <span className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wide">
                      Available End
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {new Date(seriesInfo.date_range_end).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 flex items-center justify-between">
                  <span className="text-xs text-blue-700 font-semibold">
                    Available Observations
                  </span>
                  <span className="text-lg font-bold text-blue-700">
                    {seriesInfo.n_observations}
                  </span>
                </div>
                {seriesInfo.warnings.length > 0 && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{seriesInfo.warnings[0]}</span>
                  </div>
                )}
              </div>
            ) : !selectedTargetAccount ? (
              <div className="text-xs text-slate-400 italic text-center py-4">
                Select a forecasting target to see series information.
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1 text-center">
                <p className="font-semibold">No Historical Data Found</p>
                <p className="text-[11px] text-amber-700">
                  All observations for this target are empty or zero in the selected entity.
                </p>
              </div>
            )}
          </div>

          {/* Training Date Range */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <Calendar className="w-4 h-4 text-blue-600" />
              Training Date Range
            </span>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">
                  Training Start Month
                </label>
                <input
                  type="month"
                  value={trainStart ? trainStart.slice(0, 7) : ''}
                  min={seriesInfo?.date_range_start?.slice(0, 7) || ''}
                  max={
                    trainEnd
                      ? trainEnd.slice(0, 7)
                      : seriesInfo?.date_range_end?.slice(0, 7) || ''
                  }
                  onChange={(e) => setTrainStart(e.target.value ? `${e.target.value}-01` : '')}
                  disabled={!seriesInfo || seriesInfo.n_observations === 0}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">
                  Training End Month
                </label>
                <input
                  type="month"
                  value={trainEnd ? trainEnd.slice(0, 7) : ''}
                  min={
                    trainStart
                      ? trainStart.slice(0, 7)
                      : seriesInfo?.date_range_start?.slice(0, 7) || ''
                  }
                  max={seriesInfo?.date_range_end?.slice(0, 7) || ''}
                  onChange={(e) => setTrainEnd(e.target.value ? `${e.target.value}-01` : '')}
                  disabled={!seriesInfo || seriesInfo.n_observations === 0}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                />
              </div>

              {/* Filtered observation count + validation badge */}
              <div
                className={`p-3 rounded-lg border text-xs ${
                  hasEnoughData
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <span>Selected Training Period</span>
                  <span>{filteredObsCount} month(s)</span>
                </div>
                <p className="text-[10px] mt-0.5 opacity-80">
                  {hasEnoughData
                    ? `✓ Sufficient data.`
                    : `⚠ Minimum 12 months required for training. Current selection: ${filteredObsCount} month(s).`}
                </p>
              </div>
            </div>
          </div>

          {/* Dynamic Forecast Horizon Dropdown */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <Calendar className="w-4 h-4 text-blue-600" />
              Forecast Horizon
            </span>

            <div>
              <label className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">
                Future Months to Forecast
              </label>
              <select
                value={forecastHorizon}
                onChange={(e) => setForecastHorizon(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-slate-800"
              >
                {horizonOptions.map((h) => (
                  <option key={h} value={h}>
                    {h} month{h > 1 ? 's' : ''}
                    {recommendedHorizon === h ? ' (Recommended)' : ''}
                  </option>
                ))}
              </select>

              {recommendedHorizon > 0 && (
                <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg text-[11px] text-blue-700">
                  <span className="font-semibold">Recommended:</span> {recommendedHorizon} months
                  <span className="text-blue-500 ml-1">
                    (based on {filteredObsCount} months training range)
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
