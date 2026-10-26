import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PlayCircle,
  AlertOctagon,
  Clock,
  Cpu,
  Terminal,
  ArrowRight,
  RotateCcw,
} from 'lucide-react'
import { getJobStatus } from '../api/client'
import { useSession } from '../contexts/SessionContext'
import type { JobStatus } from '../types'

export const TrainingPage: React.FC = () => {
  const navigate = useNavigate()
  const { jobId } = useSession()

  const [jobState, setJobState] = useState<JobStatus | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      navigate('/configure')
      return
    }

    let interval: any
    const pollStatus = async () => {
      try {
        const data = await getJobStatus(jobId)
        setJobState(data)

        if (data.status === 'completed') {
          clearInterval(interval)
          // Quick delay for smooth UX then redirect
          setTimeout(() => {
            navigate('/report/forecast')
          }, 1200)
        } else if (data.status === 'failed') {
          clearInterval(interval)
          setErrorMsg(data.error || 'Training job failed.')
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Error checking training status.')
      }
    }

    pollStatus()
    interval = setInterval(pollStatus, 1500)
    return () => clearInterval(interval)
  }, [jobId, navigate])

  const progressPercent = jobState
    ? Math.round((jobState.progress.completed / Math.max(jobState.progress.total, 1)) * 100)
    : 0

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Model Tournament & Training Execution</h2>
        <p className="text-xs text-slate-500 mt-1">
          Evaluating candidate models chronologically, calculating finite MAPE scores, and retraining the winning model on all history.
        </p>
      </div>

      {errorMsg ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-800 space-y-4">
          <div className="flex items-center gap-3">
            <AlertOctagon className="w-6 h-6 text-rose-600" />
            <h3 className="font-bold text-base">Tournament Execution Failed</h3>
          </div>
          <p className="text-xs bg-white p-3 rounded border border-rose-200 font-mono text-rose-700">
            {errorMsg}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/configure')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Modify Configuration</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          {/* Status Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center animate-pulse">
                <PlayCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">
                  {jobState?.status === 'completed' ? 'Tournament Completed!' : 'Evaluating Candidates...'}
                </h3>
                <p className="text-xs text-slate-500 capitalize">
                  Stage: {jobState?.stage.replace(/_/g, ' ') || 'initializing'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Elapsed: {jobState?.elapsed_seconds ?? 0}s</span>
              </div>

              {jobState?.status === 'completed' && (
                <button
                  onClick={() => navigate('/report/forecast')}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-1.5 text-xs transition shadow-2xs"
                >
                  <span>View Report</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700">Tournament Progress</span>
              <span className="text-blue-600">{progressPercent}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>
                Completed: {jobState?.progress.completed ?? 0} / {jobState?.progress.total ?? 1} evaluations
              </span>
              {jobState?.progress.current_model && (
                <span className="flex items-center gap-1 font-medium text-slate-600">
                  <Cpu className="w-3 h-3 text-blue-500" />
                  Active Model: {jobState.progress.current_model}
                </span>
              )}
            </div>
          </div>

          {/* Real-time Log Stream */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>Real-Time Evaluation Log</span>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 font-mono text-[11px] text-emerald-400 max-h-56 overflow-y-auto space-y-1">
              {(jobState?.log_tail || []).map((line, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span className="text-slate-200">{line}</span>
                </div>
              ))}
              {jobState?.status === 'running' && (
                <div className="flex items-center gap-2 text-blue-400 animate-pulse pt-1">
                  <span className="text-slate-600 select-none">&gt;</span>
                  <span>Processing...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
