"use client";

import { useState, useMemo } from "react";
import UploadZone from "./UploadZone";

import { triggerGrouping, triggerGenerate, getDownloadUrl, resetPipeline, scanInputFolder } from "../utils/api";

/**
 * PipelinePanel — left sidebar showing pipeline progress, controls, and upload.
 *
 * @param {{ jobs: object, groups: object, isConnected: boolean, onUploadComplete?: function }} props
 */
export default function PipelinePanel({ jobs, groups, isConnected, onUploadComplete }) {
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
    { key: "uploaded", label: "Uploaded", icon: "📷", count: stats.uploaded },
    { key: "classifying", label: "Classifying", icon: "🔍", count: stats.classifying },
    { key: "classified", label: "Classified", icon: "🏷️", count: stats.classified },
    { key: "processing", label: "Processing", icon: "⚙️", count: stats.processing },
    { key: "cleaned", label: "Cleaned", icon: "✨", count: stats.cleaned },
    { key: "assigned", label: "Assigned", icon: "📂", count: stats.assigned },
    { key: "ppt_ready", label: "PPT Ready", icon: "📊", count: stats.ppt_ready },
    { key: "failed", label: "Failed", icon: "❌", count: stats.failed },
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
    <aside className="w-[300px] h-full flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-base font-bold text-[var(--text-primary)]">
            Garment Catalog
          </h1>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${isConnected ? "bg-[var(--success)]" : "bg-[var(--error)]"}`}
            />
            <span className="text-[10px] text-[var(--text-muted)]">
              {isConnected ? "Live" : "Offline"}
            </span>
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

      {/* Actions */}
      <div className="p-4 space-y-2 mt-auto">
        <button
          className="btn-secondary w-full"
          onClick={handleScan}
          disabled={isScanning}
        >
          {isScanning ? "⏳ Scanning..." : "📁 Scan Input Folder"}
        </button>

        <button
          className="btn-secondary w-full"
          onClick={handleGroup}
          disabled={isGrouping || stats.cleaned === 0}
        >
          {isGrouping ? "⏳ Grouping..." : "📂 Group Images"}
        </button>

        <button
          className="btn-primary w-full"
          onClick={handleGenerate}
          disabled={isGenerating || groupCount === 0}
        >
          {isGenerating ? "⏳ Generating..." : "📊 Generate Catalog"}
        </button>

        {stats.ppt_ready > 0 && (
          <button className="btn-secondary w-full" onClick={handleDownload}>
            📥 Download Catalog
          </button>
        )}

        {stats.total > 0 && (
          <button
            className="w-full text-center py-2 text-[11px] text-[var(--text-muted)] hover:text-[var(--error)] transition-colors cursor-pointer bg-transparent border-none"
            onClick={handleReset}
          >
            Reset Pipeline
          </button>
        )}
      </div>
    </aside>
  );
}
