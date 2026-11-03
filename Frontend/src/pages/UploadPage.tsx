import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Layers,
  Calendar,
  Eye,
  Loader2,
  SlidersHorizontal,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  Check,
} from 'lucide-react'
import {
  inspectDataset,
  transformDataset,
  uploadFile,
  uploadMultipleFiles,
  mergeTransformDatasets,
} from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { HeaderDetectionResult, MultiUploadResponse, UploadedFileInfo } from '../types'

export const UploadPage: React.FC = () => {
  const navigate = useNavigate()
  const {
    datasetId,
    setDatasetId,
    filename,
    setFilename,
    activeSheet,
    setActiveSheet,
    sheetNames,
    setSheetNames,
    transformData,
    setTransformData,
  } = useSession()

  // Mode: Single File vs Multi-File Stitching
  const [uploadMode, setUploadMode] = useState<'single' | 'multi'>('single')
  const [multiUploadRes, setMultiUploadRes] = useState<MultiUploadResponse | null>(null)

  const [isUploading, setIsUploading] = useState(false)
  const [isInspecting, setIsInspecting] = useState(false)
  const [isTransforming, setIsTransforming] = useState(false)
  const [detection, setDetection] = useState<HeaderDetectionResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [previewTab, setPreviewTab] = useState<'raw' | 'transformed'>('raw')

  // Interactive Schema Mapping State
  const [periodRowIndex, setPeriodRowIndex] = useState<number>(0)
  const [dimensionRowIndex, setDimensionRowIndex] = useState<number>(1)
  const [targetColumn, setTargetColumn] = useState<string>('')
  const [descriptionColumn, setDescriptionColumn] = useState<string>('')
  const [hierarchyColumns, setHierarchyColumns] = useState<string[]>([])
  const [showAdvancedSchema, setShowAdvancedSchema] = useState<boolean>(true)

  // Derive candidate column names from raw preview at dimensionRowIndex or common_dimensions
  const candidateColumns: string[] = React.useMemo(() => {
    if (uploadMode === 'multi' && multiUploadRes?.common_dimensions && multiUploadRes.common_dimensions.length > 0) {
      return multiUploadRes.common_dimensions
    }
    if (!detection || !detection.raw_preview || detection.raw_preview.length <= dimensionRowIndex) {
      return detection?.dimension_columns?.map((c) => c.name) || []
    }
    const row = detection.raw_preview[dimensionRowIndex] || {}
    const names = Object.values(row)
      .map((v) => (v !== null && v !== undefined ? String(v).trim() : ''))
      .filter((v) => v.length > 0 && !/^\d{4}-\d{2}/.test(v) && !/^\d{4}$/.test(v))
    return Array.from(new Set(names))
  }, [detection, dimensionRowIndex, uploadMode, multiUploadRes])

  // Sync schema defaults when detection or dimensionRowIndex updates
  useEffect(() => {
    if (!detection) return

    const pRow = detection.period_row_index ?? 0
    const dRow = detection.dimension_row_index ?? 1
    setPeriodRowIndex(pRow)
    setDimensionRowIndex(dRow)

    const cols = candidateColumns.length > 0 ? candidateColumns : detection.dimension_columns.map((c) => c.name)

    // Detect target: prefer column containing 'account' or first column
    const detectedTarget =
      cols.find((c) => c.toLowerCase() === 'account') ||
      cols.find((c) => c.toLowerCase().includes('account')) ||
      cols[0] ||
      ''
    setTargetColumn(detectedTarget)

    // Detect description: prefer column containing 'description'
    const detectedDesc =
      cols.find((c) => c.toLowerCase() === 'description') ||
      cols.find((c) => c.toLowerCase().includes('description')) ||
      ''
    setDescriptionColumn(detectedDesc)

    // Hierarchy: all other columns
    const remaining = cols.filter(
      (c) => c !== detectedTarget && c !== detectedDesc
    )
    setHierarchyColumns(remaining)
  }, [detection])

  // When dimension row changes, recalculate target / desc / hierarchy
  const handleDimensionRowChange = (newRow: number) => {
    setDimensionRowIndex(newRow)
    if (!detection || !detection.raw_preview || detection.raw_preview.length <= newRow) return
    const row = detection.raw_preview[newRow] || {}
    const cols = Object.values(row)
      .map((v) => (v !== null && v !== undefined ? String(v).trim() : ''))
      .filter((v) => v.length > 0 && !/^\d{4}-\d{2}/.test(v) && !/^\d{4}$/.test(v))
    const uniqueCols = Array.from(new Set(cols))

    const detectedTarget =
      uniqueCols.find((c) => c.toLowerCase() === 'account') ||
      uniqueCols.find((c) => c.toLowerCase().includes('account')) ||
      uniqueCols[0] ||
      ''
    setTargetColumn(detectedTarget)

    const detectedDesc =
      uniqueCols.find((c) => c.toLowerCase() === 'description') ||
      uniqueCols.find((c) => c.toLowerCase().includes('description')) ||
      ''
    setDescriptionColumn(detectedDesc)

    const remaining = uniqueCols.filter(
      (c) => c !== detectedTarget && c !== detectedDesc
    )
    setHierarchyColumns(remaining)
  }

  // Handle single file drop or selection
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setErrorMsg(null)
    setIsUploading(true)
    try {
      const res = await uploadFile(file)
      setDatasetId(res.dataset_id)
      setFilename(res.filename)
      setSheetNames(res.sheet_names)
      const defaultSheet = res.sheet_names[0]
      setActiveSheet(defaultSheet)

      // Automatically inspect the default sheet
      await runInspect(res.dataset_id, defaultSheet)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'File upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  // Handle multiple files drop or selection
  const handleMultiFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0) return

    setErrorMsg(null)
    setIsUploading(true)
    try {
      const res = await uploadMultipleFiles(files)
      setMultiUploadRes(res)

      // If compatible, initialize candidate cols and schema mapping
      if (res.common_dimensions && res.common_dimensions.length > 0) {
        const cols = res.common_dimensions
        const detectedTarget =
          cols.find((c) => c.toLowerCase() === 'account') ||
          cols.find((c) => c.toLowerCase().includes('account')) ||
          cols[0] ||
          ''
        setTargetColumn(detectedTarget)

        const detectedDesc =
          cols.find((c) => c.toLowerCase() === 'description') ||
          cols.find((c) => c.toLowerCase().includes('description')) ||
          ''
        setDescriptionColumn(detectedDesc)

        const remaining = cols.filter(
          (c) => c !== detectedTarget && c !== detectedDesc
        )
        setHierarchyColumns(remaining)
      }

      // Inspect base file for raw preview
      if (res.files && res.files.length > 0) {
        const base = res.files[0]
        const sheet = base.sheet_names[0] || 'Sheet1'
        try {
          const det = await inspectDataset(base.dataset_id, sheet)
          setDetection(det)
        } catch {
          // Non-critical
        }
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Multiple file upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  // Remove a file from the multi-upload queue and recalculate compatibility
  const handleRemoveMultiFile = (idxToRemove: number) => {
    if (!multiUploadRes) return
    const remainingFiles = multiUploadRes.files.filter((_, idx) => idx !== idxToRemove)
    if (remainingFiles.length === 0) {
      setMultiUploadRes(null)
      return
    }

    // Recalculate compatibility
    const base = remainingFiles[0]
    const baseDims = base.dimension_columns || []
    let isCompat = true
    let incompatReason: string | null = null

    for (let i = 1; i < remainingFiles.length; i++) {
      const f = remainingFiles[i]
      if (f.header_depth !== base.header_depth) {
        isCompat = false
        incompatReason = `Header Depth Mismatch: '${f.filename}' has header depth ${f.header_depth}, but '${base.filename}' has depth ${base.header_depth}.`
        break
      }
      const fDims = f.dimension_columns || []
      if (JSON.stringify(fDims) !== JSON.stringify(baseDims)) {
        isCompat = false
        incompatReason = `Structural Mismatch: '${f.filename}' has dimension columns [${fDims.join(', ')}], which does not match '${base.filename}' [${baseDims.join(', ')}].`
        break
      }
    }

    const allStarts = remainingFiles.map((f) => f.date_range_start).filter(Boolean) as string[]
    const allEnds = remainingFiles.map((f) => f.date_range_end).filter(Boolean) as string[]
    allStarts.sort()
    allEnds.sort()
    const totalMonths = remainingFiles.reduce((acc, f) => acc + (f.period_count || 0), 0)

    setMultiUploadRes({
      files: remainingFiles,
      is_compatible: isCompat,
      common_dimensions: isCompat ? baseDims : [],
      incompatibility_reason: incompatReason,
      unified_timeline_start: allStarts[0] || null,
      unified_timeline_end: allEnds[allEnds.length - 1] || null,
      total_months: totalMonths,
    })
  }

  const runInspect = async (id: string, sheet: string) => {
    setIsInspecting(true)
    setErrorMsg(null)
    try {
      const det = await inspectDataset(id, sheet)
      setDetection(det)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Failed to inspect worksheet.')
    } finally {
      setIsInspecting(false)
    }
  }

  const handleSheetChange = async (sheet: string) => {
    setActiveSheet(sheet)
    if (datasetId) {
      await runInspect(datasetId, sheet)
    }
  }

  const handleTransform = async () => {
    if (!datasetId || !activeSheet) return
    setIsTransforming(true)
    setErrorMsg(null)
    try {
      const res = await transformDataset(datasetId, activeSheet, {
        schema_config: {
          period_row_index: periodRowIndex,
          dimension_row_index: dimensionRowIndex,
          target_column: targetColumn,
          description_column: descriptionColumn && descriptionColumn !== '(None)' ? descriptionColumn : undefined,
          hierarchy_columns: hierarchyColumns,
        },
      })
      setTransformData(res)
      setPreviewTab('transformed')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Transformation failed.')
    } finally {
      setIsTransforming(false)
    }
  }

  const handleMergeTransform = async () => {
    if (!multiUploadRes || !multiUploadRes.is_compatible || multiUploadRes.files.length < 2) return

    setIsTransforming(true)
    setErrorMsg(null)
    try {
      const datasetIds = multiUploadRes.files.map((f) => f.dataset_id)
      const res = await mergeTransformDatasets(datasetIds, {
        period_row_index: periodRowIndex,
        dimension_row_index: dimensionRowIndex,
        target_column: targetColumn,
        description_column: descriptionColumn && descriptionColumn !== '(None)' ? descriptionColumn : undefined,
        hierarchy_columns: hierarchyColumns,
      })

      setDatasetId(res.dataset_id)
      setFilename(
        `${multiUploadRes.files.length} Merged Files (${multiUploadRes.unified_timeline_start?.slice(0, 7) || ''} - ${multiUploadRes.unified_timeline_end?.slice(0, 7) || ''})`
      )
      setTransformData(res)
      setPreviewTab('transformed')
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Merge and transform failed.')
    } finally {
      setIsTransforming(false)
    }
  }

  const moveHierarchyColumn = (idx: number, direction: 'up' | 'down') => {
    const newCols = [...hierarchyColumns]
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= newCols.length) return
    const temp = newCols[idx]
    newCols[idx] = newCols[targetIdx]
    newCols[targetIdx] = temp
    setHierarchyColumns(newCols)
  }

  const toggleHierarchyColumn = (col: string) => {
    if (hierarchyColumns.includes(col)) {
      setHierarchyColumns(hierarchyColumns.filter((c) => c !== col))
    } else {
      setHierarchyColumns([...hierarchyColumns, col])
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Data Upload & Schema Configuration</h2>
          <p className="text-xs text-slate-500 mt-1">
            Upload single or multiple Excel workbooks. System stitches multi-year continuous series and detects structural compatibility.
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setUploadMode('single')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              uploadMode === 'single'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Single File</span>
          </button>
          <button
            type="button"
            onClick={() => setUploadMode('multi')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              uploadMode === 'multi'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Multi-File Stitching</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700 font-bold uppercase tracking-wide">
              Multi-Year
            </span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Error</p>
            <p className="text-xs mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* SINGLE FILE MODE */}
      {uploadMode === 'single' && (
        <>
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-500 transition relative">
            <input
              type="file"
              accept=".xlsx, .xls, .xlsm"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <UploadCloud className="w-6 h-6" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {isUploading ? 'Uploading and parsing workbook...' : 'Click or drag & drop single Excel workbook'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Supports .xlsx, .xls (SAP Analytics Cloud Story, Product Sheets, or custom multi-tier tables)
                </p>
              </div>
              {filename && (
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-medium">
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Loaded: {filename}</span>
                </div>
              )}
            </div>
          </div>

          {/* Single File Sheet selection & actions */}
          {sheetNames.length > 0 && (
            <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Worksheet:
                  </label>
                  <select
                    value={activeSheet || ''}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    disabled={isInspecting}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {sheetNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTransform}
                    disabled={isTransforming || isInspecting || !targetColumn}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50"
                  >
                    {isTransforming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Transforming...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        <span>Confirm & Transform</span>
                      </>
                    )}
                  </button>

                  {transformData && (
                    <button
                      onClick={() => navigate('/configure')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs"
                    >
                      <span>Configure Forecast</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MULTI-FILE STITCHING MODE */}
      {uploadMode === 'multi' && (
        <div className="space-y-5">
          {/* Multi-file dropzone */}
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-500 transition relative">
            <input
              type="file"
              multiple
              accept=".xlsx, .xls, .xlsm"
              onChange={handleMultiFileUpload}
              disabled={isUploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                {isUploading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Layers className="w-6 h-6" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">
                  {isUploading
                    ? 'Uploading and inspecting multiple workbooks...'
                    : 'Click or drag & drop multiple Excel workbooks (e.g. 2023.xlsx, 2024 Data.xlsx)'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Hold Ctrl or Shift to select multiple files. The system checks structural compatibility and stitches them chronologically.
                </p>
              </div>
            </div>
          </div>

          {/* Multi-upload Queue & Status */}
          {multiUploadRes && multiUploadRes.files.length > 0 && (
            <div className="space-y-4">
              {/* Compatibility Status Banner */}
              {multiUploadRes.is_compatible ? (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                      <span className="font-bold text-sm">
                        All {multiUploadRes.files.length} Files Structurally Compatible & Ready to Merge
                      </span>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full">
                      ✓ Compatible
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                      <span>
                        Unified Timeline: <strong>{multiUploadRes.total_months} Months</strong> (
                        {multiUploadRes.unified_timeline_start?.slice(0, 7)} →{' '}
                        {multiUploadRes.unified_timeline_end?.slice(0, 7)})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 font-medium">
                      <Layers className="w-3.5 h-3.5 text-emerald-600" />
                      <span>
                        Shared Dimensions:{' '}
                        <strong>[{multiUploadRes.common_dimensions.join(', ')}]</strong>
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-rose-600" />
                      <span className="font-bold text-sm">
                        Structural Incompatibility Detected — Cannot Merge
                      </span>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full">
                      ✕ Incompatible
                    </span>
                  </div>
                  <p className="text-xs text-rose-700">
                    {multiUploadRes.incompatibility_reason ||
                      'Files do not share matching dimension columns or header depth.'}
                  </p>
                  <p className="text-[11px] text-rose-500">
                    Tip: Remove the incompatible file below or upload files with identical column layouts.
                  </p>
                </div>
              )}

              {/* Uploaded File Cards */}
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                <div className="px-4 py-2.5 bg-slate-50 text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                  <span>Uploaded Workbooks Queue ({multiUploadRes.files.length})</span>
                  <span className="text-[11px] font-normal text-slate-400">
                    First file acts as schema blueprint
                  </span>
                </div>

                {multiUploadRes.files.map((f: UploadedFileInfo, idx: number) => {
                  const isBase = idx === 0
                  return (
                    <div
                      key={f.dataset_id}
                      className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] ${
                            isBase
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{f.filename}</span>
                            {isBase && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-bold">
                                Base Schema
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-slate-400 text-[11px] mt-0.5">
                            <span>
                              {f.period_count} periods ({f.date_range_start?.slice(0, 7)} →{' '}
                              {f.date_range_end?.slice(0, 7)})
                            </span>
                            <span>•</span>
                            <span>Depth: {f.header_depth}</span>
                            <span>•</span>
                            <span>Dims: [{f.dimension_columns?.join(', ')}]</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleRemoveMultiFile(idx)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                          title="Remove file"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Multi-file Action Controls */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-4">
                <div className="text-xs text-slate-500">
                  {multiUploadRes.is_compatible ? (
                    <span className="text-emerald-700 font-medium">
                      ✓ Ready to stitch {multiUploadRes.files.length} workbooks across{' '}
                      {multiUploadRes.total_months} continuous months.
                    </span>
                  ) : (
                    <span className="text-rose-600 font-medium">
                      ✕ Resolve incompatibility before proceeding.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleMergeTransform}
                    disabled={
                      isTransforming ||
                      !multiUploadRes.is_compatible ||
                      multiUploadRes.files.length < 2 ||
                      !targetColumn
                    }
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50"
                  >
                    {isTransforming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Stitching & Transforming...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Merge & Transform ({multiUploadRes.files.length} Files)</span>
                      </>
                    )}
                  </button>

                  {transformData && (
                    <button
                      onClick={() => navigate('/configure')}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2 shadow-xs"
                    >
                      <span>Configure Forecast</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interactive Universal Schema Mapping Card (Shared for Single & Multi Compatible) */}
      {(detection || (uploadMode === 'multi' && multiUploadRes?.is_compatible)) && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Interactive Schema & Hierarchy Mapping
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedSchema(!showAdvancedSchema)}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
            >
              {showAdvancedSchema ? 'Hide Options' : 'Customize Mapping'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedSchema ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {showAdvancedSchema && (
            <div className="space-y-4">
              {/* Row Selectors (Single File mode has raw preview rows, multi mode shows defaults) */}
              {detection && detection.raw_preview && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-blue-500" />
                      <span>Date / Period Header Row:</span>
                    </label>
                    <select
                      value={periodRowIndex}
                      onChange={(e) => setPeriodRowIndex(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {detection.raw_preview.slice(0, 5).map((_, rIdx) => (
                        <option key={rIdx} value={rIdx}>
                          Row {rIdx} (e.g.{' '}
                          {Object.values(detection.raw_preview[rIdx] || {})
                            .slice(0, 3)
                            .filter(Boolean)
                            .join(' | ')}
                          )
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      Row containing month or date columns (e.g. 2023-01, Jan 2023).
                    </p>
                  </div>

                  <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-blue-500" />
                      <span>Column Names / Dimension Header Row:</span>
                    </label>
                    <select
                      value={dimensionRowIndex}
                      onChange={(e) => handleDimensionRowChange(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {detection.raw_preview.slice(0, 5).map((_, rIdx) => (
                        <option key={rIdx} value={rIdx}>
                          Row {rIdx} (e.g.{' '}
                          {Object.values(detection.raw_preview[rIdx] || {})
                            .slice(0, 4)
                            .filter(Boolean)
                            .join(', ')}
                          )
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400">
                      Row containing column names (Data starts directly on row {dimensionRowIndex + 1}).
                    </p>
                  </div>
                </div>
              )}

              {/* Target & 1-to-1 Description Column */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Target / Account Column:
                  </label>
                  <select
                    value={targetColumn}
                    onChange={(e) => {
                      const val = e.target.value
                      setTargetColumn(val)
                      setHierarchyColumns(hierarchyColumns.filter((c) => c !== val))
                    }}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {candidateColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400">
                    Primary metric or account code identifier (e.g. ACCOUNT, Measure).
                  </p>
                </div>

                <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    1-to-1 Description Column (Optional):
                  </label>
                  <select
                    value={descriptionColumn}
                    onChange={(e) => {
                      const val = e.target.value
                      setDescriptionColumn(val)
                      if (val && val !== '(None)') {
                        setHierarchyColumns(hierarchyColumns.filter((c) => c !== val))
                      }
                    }}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">(None)</option>
                    {candidateColumns
                      .filter((col) => col !== targetColumn)
                      .map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                  </select>
                  <p className="text-[11px] text-slate-400">
                    Optional human-readable label mapped 1:1 with target (e.g. Description).
                  </p>
                </div>
              </div>

              {/* Multi-Level Hierarchy Selection & Ordering */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-slate-800 block">
                      Multi-Level Hierarchy Levels (Parent ➔ Child ➔ Leaf Segments):
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Reorder or toggle hierarchy levels. Each leaf segment will be forecasted independently.
                    </span>
                  </div>
                  <span className="text-[11px] text-blue-600 font-semibold px-2 py-0.5 rounded bg-blue-50">
                    {hierarchyColumns.length} Level{hierarchyColumns.length !== 1 ? 's' : ''} Configured
                  </span>
                </div>

                {/* Ordered Hierarchy Badges */}
                {hierarchyColumns.length > 0 ? (
                  <div className="space-y-2">
                    {hierarchyColumns.map((col, idx) => (
                      <div
                        key={col}
                        className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[10px]">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-slate-800">{col}</span>
                          <span className="text-[10px] text-slate-400">
                            {idx === 0
                              ? '(Top Level / Parent)'
                              : idx === hierarchyColumns.length - 1
                              ? '(Leaf Segment)'
                              : '(Sub-Level)'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveHierarchyColumn(idx, 'up')}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            title="Move up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === hierarchyColumns.length - 1}
                            onClick={() => moveHierarchyColumn(idx, 'down')}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            title="Move down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleHierarchyColumn(col)}
                            className="ml-2 text-rose-500 hover:text-rose-700 text-[11px]"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 italic">
                    No hierarchy levels selected. Add at least one dimension column below.
                  </p>
                )}

                {/* Add back unused candidate columns */}
                {candidateColumns.filter(
                  (c) => c !== targetColumn && c !== descriptionColumn && !hierarchyColumns.includes(c)
                ).length > 0 && (
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-slate-500">Available to add:</span>
                    {candidateColumns
                      .filter(
                        (c) =>
                          c !== targetColumn &&
                          c !== descriptionColumn &&
                          !hierarchyColumns.includes(c)
                      )
                      .map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => toggleHierarchyColumn(col)}
                          className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium flex items-center gap-1 transition"
                        >
                          <span>+ {col}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary diagnosis metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs pt-2">
            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="text-slate-400 block">Header Depth</span>
              <span className="font-semibold text-slate-800 text-sm">
                {dimensionRowIndex + 1} rows
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                (Data starts row {dimensionRowIndex + 2})
              </span>
            </div>

            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="text-slate-400 block">Target Account</span>
              <span className="font-semibold text-slate-800 text-sm truncate block">
                {targetColumn || 'None'}
              </span>
              <span className="text-[10px] text-slate-500 truncate block mt-0.5">
                {descriptionColumn ? `Desc: ${descriptionColumn}` : 'No description'}
              </span>
            </div>

            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="text-slate-400 block">Time Periods</span>
              <span className="font-semibold text-slate-800 text-sm">
                {uploadMode === 'multi' && multiUploadRes
                  ? `${multiUploadRes.total_months} months`
                  : detection
                  ? `${detection.period_columns.length} months`
                  : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {uploadMode === 'multi'
                  ? `Across ${multiUploadRes?.files.length || 0} files`
                  : `Frequency: ${detection?.frequency || 'Monthly'}`}
              </span>
            </div>

            <div className="bg-white p-3 rounded border border-slate-200">
              <span className="text-slate-400 block">Date Range</span>
              <span className="font-semibold text-slate-800 text-xs flex items-center gap-1 mt-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                {uploadMode === 'multi' && multiUploadRes
                  ? `${multiUploadRes.unified_timeline_start?.slice(0, 7) || 'N/A'} → ${
                      multiUploadRes.unified_timeline_end?.slice(0, 7) || 'N/A'
                    }`
                  : `${detection?.date_range_start ? detection.date_range_start.slice(0, 7) : 'N/A'} → ${
                      detection?.date_range_end ? detection.date_range_end.slice(0, 7) : 'N/A'
                    }`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Preview Section */}
      {(detection || transformData) && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Data Preview
              </span>
            </div>

            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs font-medium">
              {detection && (
                <button
                  onClick={() => setPreviewTab('raw')}
                  className={`px-3 py-1 rounded-md transition ${
                    previewTab === 'raw' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Raw Sheet (First 8 Rows)
                </button>
              )}
              {transformData && (
                <button
                  onClick={() => setPreviewTab('transformed')}
                  className={`px-3 py-1 rounded-md transition ${
                    previewTab === 'transformed' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Transformed Long Format ({transformData.row_count.toLocaleString()} rows)
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-96">
            {previewTab === 'raw' && detection && detection.raw_preview && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 border-r border-slate-200 w-12 text-center text-slate-400">#</th>
                    {Object.keys(detection.raw_preview[0] || {}).map((colKey) => (
                      <th key={colKey} className="px-3 py-2 border-r border-slate-200 whitespace-nowrap">
                        Col {colKey}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {detection.raw_preview.map((row, idx) => {
                    const isPeriodRow = idx === periodRowIndex
                    const isDimensionRow = idx === dimensionRowIndex
                    return (
                      <tr
                        key={idx}
                        className={
                          isDimensionRow
                            ? 'bg-blue-50/80 font-bold text-blue-900'
                            : isPeriodRow
                            ? 'bg-amber-50/80 font-semibold text-amber-900'
                            : idx < Math.max(periodRowIndex, dimensionRowIndex) + 1
                            ? 'bg-slate-50 font-medium text-slate-600'
                            : 'hover:bg-slate-50'
                        }
                      >
                        <td className="px-3 py-1.5 border-r border-slate-200 text-center text-slate-400">
                          {idx}
                          {isPeriodRow && <span className="ml-1 text-[9px] text-amber-600">●Date</span>}
                          {isDimensionRow && <span className="ml-1 text-[9px] text-blue-600">●Header</span>}
                        </td>
                        {Object.values(row).map((val: any, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 border-r border-slate-200 whitespace-nowrap">
                            {val === null || val === undefined ? (
                              <span className="text-slate-300 italic">null</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {previewTab === 'transformed' && transformData && (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 border-r border-slate-200">Date</th>
                    {transformData.dimension_columns.map((d) => (
                      <th key={d} className="px-3 py-2 border-r border-slate-200">
                        {d}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Value (Target)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {transformData.preview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5 border-r border-slate-200 font-sans font-medium text-slate-700">
                        {row.date ? String(row.date).slice(0, 10) : ''}
                      </td>
                      {transformData.dimension_columns.map((d) => (
                        <td key={d} className="px-3 py-1.5 border-r border-slate-200">
                          {row[d] !== null && row[d] !== undefined ? String(row[d]) : '-'}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold text-blue-600">
                        {row.value !== null && row.value !== undefined
                          ? Number(row.value).toLocaleString()
                          : <span className="text-slate-300 italic">null</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

