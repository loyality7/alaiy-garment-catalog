"use client";

import { useState, useMemo } from "react";
import UploadZone from "./UploadZone";

import { triggerGrouping, triggerGenerate, getDownloadUrl, resetPipeline, scanInputFolder } from "../utils/api";

/**
 * PipelinePanel — left sidebar showing pipeline progress, controls, and upload.
 *
 * @param {{ jobs: object, groups: object, isConnected: boolean, onUploadComplete?: function }} props
 */
export default function PipelinePanel({ jobs, groups, isConnected, onUploadComplete, onToggle }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGrouping, setIsGrouping] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Calculate stats
  const stats = useMemo(() => {
    const jobList = Object.values(jobs || {});
    const counts = {
      total: jobList.length,
      uploaded: 0,
      classifying: 0,
      classified: 0,
      processing: 0,
      cleaned: 0,
      assigned: 0,
      ppt_ready: 0,
      failed: 0,
    };

    jobList.forEach((job) => {
      const status = job.status || "uploaded";
      if (status in counts) {
        counts[status]++;
      }
    });

    return counts;
  }, [jobs]);

  const groupCount = Object.keys(groups || {}).length;

  // Overall progress percentage
  const progressPct = useMemo(() => {
    if (stats.total === 0) return 0;
    const doneStatuses = ["cleaned", "assigned", "ppt_ready"];
    const done = Object.values(jobs || {}).filter((j) =>
      doneStatuses.includes(j.status)
    ).length;
    return Math.round((done / stats.total) * 100);
  }, [jobs, stats.total]);

  // Pipeline stages for display
  const stages = [
    { key: "uploaded", label: "Uploaded", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>, count: stats.uploaded },
    { key: "classifying", label: "Classifying", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>, count: stats.classifying },
    { key: "classified", label: "Classified", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>, count: stats.classified },
    { key: "processing", label: "Processing", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>, count: stats.processing },
    { key: "cleaned", label: "Cleaned", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>, count: stats.cleaned },
    { key: "assigned", label: "Assigned", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>, count: stats.assigned },
    { key: "ppt_ready", label: "PPT Ready", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>, count: stats.ppt_ready },
    { key: "failed", label: "Failed", icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, count: stats.failed },
  ];

  const handleGroup = async () => {
    setIsGrouping(true);
    try {
      await triggerGrouping();
    } catch (err) {
      console.error("Grouping error:", err);
    } finally {
      setTimeout(() => setIsGrouping(false), 2000);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await triggerGenerate();
    } catch (err) {
      console.error("Generation error:", err);
    } finally {
      setTimeout(() => setIsGenerating(false), 3000);
    }
  };

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await scanInputFolder();
    } catch (err) {
      console.error("Scan error:", err);
    } finally {
      setTimeout(() => setIsScanning(false), 2000);
    }
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(), "_blank");
  };

  const handleReset = async () => {
    if (confirm("Reset all jobs and style groups? This cannot be undone.")) {
      await resetPipeline();
    }
  };

  return (
    <aside className="w-[300px] h-full flex flex-col border-r border-[var(--border)] bg-[var(--bg-primary)] overflow-y-auto">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-[var(--text-primary)]">
              Garment Catalog
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${isConnected ? "bg-[var(--success)]" : "bg-[var(--error)]"}`}
              />
              <span className="text-[10px] text-[var(--text-muted)]">
                {isConnected ? "Live" : "Offline"}
              </span>
            </div>
            {onToggle && (
              <button 
                onClick={onToggle}
                className="p-1 hover:bg-[var(--bg-surface)] rounded text-[var(--text-muted)] transition-colors"
                title="Collapse Panel"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-muted)]">
          Alaiy Automated Pipeline
        </p>
      </div>

      {/* Upload zone */}
      <div className="p-4 border-b border-[var(--border)]">
        <UploadZone onUploadComplete={onUploadComplete} />
      </div>

      {/* Pipeline stages */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Pipeline
          </h2>
          {stats.total > 0 && (
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              {progressPct}%
            </span>
          )}
        </div>

        {/* Progress bar */}
        {stats.total > 0 && (
          <div className="progress-bar mb-3">
            <div
              className="progress-bar-fill"
              style={{
                width: `${progressPct}%`,
                background: progressPct === 100
                  ? "var(--success)"
                  : "var(--accent)",
              }}
            />
          </div>
        )}

        {/* Stage counts */}
        <div className="space-y-1">
          {stages.map((stage) => (
            <div
              key={stage.key}
              className={`flex items-center justify-between py-1.5 px-2 rounded-lg text-xs transition-colors ${
                stage.count > 0
                  ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{stage.icon}</span>
                <span>{stage.label}</span>
              </div>
              <span
                className={`font-mono text-[11px] ${
                  stage.count > 0 ? "font-bold" : ""
                }`}
              >
                {stage.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Style groups count */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Style Groups
          </h2>
          <span className="text-lg font-bold text-[var(--accent)] font-mono">
            {groupCount}
          </span>
        </div>
      </div>

    </aside>
  );
}
