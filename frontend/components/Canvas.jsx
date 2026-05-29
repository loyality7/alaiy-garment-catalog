"use client";

import { useMemo, useState, useEffect } from "react";
import StyleGroup from "./StyleGroup";
import ImageCard from "./ImageCard";
import { getThumbnailUrl, deleteJob, overrideClassification, triggerGrouping, triggerGenerate, getDownloadUrl, scanInputFolder, resetPipeline, fetchPreview } from "../utils/api";

/**
 * Canvas — main workspace area that displays style groups as clusters
 * and ungrouped images. Whiteboard-style layout.
 *
 * @param {{ jobs: object, groups: object, onDropImage?: function }} props
 */
export default function Canvas({
  jobs,
  groups,
  onDropImage,
  isConnected,
  isProcessing,
  workspaces = [],
  activeWorkspaceIndex = 0,
  onWorkspaceChange,
  onAddWorkspace
}) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [viewMode, setViewMode] = useState("groups"); // "groups" | "all" | "ungrouped"

  const [isGenerating, setIsGenerating] = useState(false);
  const [isGrouping, setIsGrouping] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [overrideForm, setOverrideForm] = useState(null);
  const [previewSlides, setPreviewSlides] = useState(null);
  useEffect(() => { setOverrideForm(null); }, [selectedJob?.id]);

  // Compute stats for button disabled states
  const stats = useMemo(() => {
    const jobList = Object.values(jobs || {});
    const counts = { cleaned: 0, ppt_ready: 0 };
    jobList.forEach(job => {
      if (job.status === "cleaned") counts.cleaned++;
      if (job.status === "ppt_ready") counts.ppt_ready++;
    });
    return counts;
  }, [jobs]);

  const handleGroup = async () => {
    setIsGrouping(true);
    try { await triggerGrouping(); }
    catch (err) { console.error("Grouping error:", err); }
    finally { setTimeout(() => setIsGrouping(false), 2000); }
  };

  const handlePreview = async () => {
    try {
      const groupIds = sortedGroups.map(g => g.id);
      const data = await fetchPreview(groupIds);
      setPreviewSlides(data.slides || []);
    } catch (err) { console.error("Preview error:", err); }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const groupIds = sortedGroups.map(g => g.id);
      await triggerGenerate(groupIds);
    }
    catch (err) { console.error("Generation error:", err); }
    finally { setTimeout(() => setIsGenerating(false), 3000); }
  };

  const handleScan = async () => {
    setIsScanning(true);
    try { await scanInputFolder(); }
    catch (err) { console.error("Scan error:", err); }
    finally { setTimeout(() => setIsScanning(false), 2000); }
  };

  const handleDownload = () => {
    window.open(getDownloadUrl(), "_blank");
  };

  const handleReset = async () => {
    if (confirm("Are you sure you want to reset the entire pipeline?")) {
      try { await resetPipeline(); }
      catch (err) { console.error("Reset error:", err); }
    }
  };

  // Sort groups by style number
  const sortedGroups = useMemo(() => {
    return Object.values(groups || {}).sort(
      (a, b) => (a.style_number || 0) - (b.style_number || 0)
    );
  }, [groups]);

  // Find ungrouped images
  const ungroupedJobs = useMemo(() => {
    const groupedIds = new Set();
    Object.values(groups || {}).forEach((g) => {
      (g.image_ids || []).forEach((id) => groupedIds.add(id));
    });

    return Object.values(jobs || {}).filter((j) => !groupedIds.has(j.id));
  }, [jobs, groups]);

  // All jobs as array
  const allJobs = useMemo(() => Object.values(jobs || {}), [jobs]);

  const handleImageClick = (job) => {
    setSelectedJob(selectedJob?.id === job.id ? null : job);
  };

  const handleDropImage = (jobId, groupId) => {
    if (onDropImage) {
      onDropImage(jobId, groupId);
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden canvas-grid">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-[var(--bg-primary)] relative z-20 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)] m-0">
              Workspace
            </h2>
            <div className="flex items-center gap-1.5 ml-2">
              <span
                className={`w-2 h-2 rounded-full ${isConnected ? "bg-[var(--success)] shadow-[0_0_8px_var(--success)]" : "bg-[var(--error)] shadow-[0_0_8px_var(--error)]"}`}
              />
              <span className="text-[10px] text-black/60 font-semibold tracking-wider uppercase">
                {isConnected ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center bg-[var(--bg-secondary)] rounded-full p-1 border border-[var(--border)]">
          <button
            onClick={() => setViewMode("groups")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all flex items-center gap-2 ${viewMode === "groups"
                ? "bg-white text-[var(--accent)] shadow-sm"
                : "text-black hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            Groups
          </button>
          <button
            onClick={() => setViewMode("all")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all flex items-center gap-2 ${viewMode === "all"
                ? "bg-white text-[var(--info)] shadow-sm"
                : "text-black hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            All Images
          </button>
          <button
            onClick={() => setViewMode("ungrouped")}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all flex items-center gap-2 ${viewMode === "ungrouped"
                ? "bg-white text-[var(--error)] shadow-sm"
                : "text-black hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Ungrouped
            {ungroupedJobs.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--error)] text-white text-[10px] font-bold leading-none">{ungroupedJobs.length}</span>
            )}
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleScan}
            disabled={isScanning || isProcessing}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--border)] transition-colors flex items-center gap-1.5 shadow-sm ${isScanning || isProcessing ? "bg-black/5 text-black/40 cursor-not-allowed opacity-50" : "bg-white text-black hover:border-[var(--accent)] hover:text-[var(--accent)]"}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            {isScanning ? "Scanning..." : isProcessing ? "Processing..." : "Scan"}
          </button>
          <button
            onClick={handleGroup}
            disabled={isGrouping || stats.cleaned === 0}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-all disabled:opacity-50 flex items-center gap-1.5 relative ${stats.cleaned > 0
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-[0_0_12px_rgba(236,72,153,0.4)]"
                : "border-[var(--border)] bg-white text-black hover:border-[var(--accent)] hover:text-[var(--accent)] shadow-sm"
              }`}
          >
            {stats.cleaned > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[var(--accent)] rounded-full animate-ping" />
            )}
            {stats.cleaned > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[var(--accent)] rounded-full" />
            )}
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            {isGrouping ? "Grouping..." : "Group"}
          </button>
          <button
            onClick={handlePreview}
            disabled={sortedGroups.length === 0}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--border)] bg-white text-black hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            Preview
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || sortedGroups.length === 0}
            className="px-4 py-1.5 text-xs font-semibold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            {isGenerating ? "Generating..." : "Generate Catalog"}
          </button>
          {stats.ppt_ready > 0 && !isGenerating && (
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)] hover:text-white transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </button>
          )}
          {Object.keys(jobs).length > 0 && (
            <button
              onClick={handleReset}
              className="flex flex-col items-center justify-center px-3 py-1 text-black hover:text-[var(--error)] hover:bg-[var(--error)]/10 rounded-lg transition-colors"
              title="Reset Pipeline"
            >
              <svg className="w-4 h-4 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <span className="text-[9px] font-bold uppercase tracking-wider">Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Workspace Tabs (Below Header) */}
      <div className="w-full bg-[var(--bg-canvas)] border-b border-[var(--border)] px-6 py-2 flex items-center justify-start gap-2 overflow-x-auto relative z-10 shadow-sm pl-[65px]">
        <span className="text-[10px] font-bold text-[var(--text-muted)] mr-2 tracking-widest uppercase">Workspaces:</span>
        {workspaces.map((ws, i) => {
          const imgCount = ws.length;
          const groupCount = new Set(ws.map(j => j.style_group).filter(Boolean)).size;
          const thumbnails = ws.slice(0, 3);
          return (
            <button
              key={i}
              onClick={() => onWorkspaceChange && onWorkspaceChange(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 whitespace-nowrap ${i === activeWorkspaceIndex
                  ? 'bg-[var(--accent)] text-white shadow-[0_4px_10px_rgba(236,72,153,0.2)]'
                  : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                }`}
            >
              {/* Mini thumbnails */}
              <div className="flex -space-x-1">
                {thumbnails.length > 0 ? thumbnails.map((j) => (
                  <div key={j.id} className="w-5 h-5 rounded-full border-2 border-white overflow-hidden bg-[var(--bg-surface)]">
                    <img
                      src={getThumbnailUrl(j.id)}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={e => { e.target.style.display = "none"; }}
                    />
                  </div>
                )) : (
                  <div className="w-5 h-5 rounded-full border-2 border-white bg-[var(--bg-surface)] flex items-center justify-center text-[8px] text-[var(--text-muted)]">∅</div>
                )}
              </div>
              <span className="text-inherit">WS {i + 1}</span>
              {imgCount > 0 && <span className={`text-[9px] ${i === activeWorkspaceIndex ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>{imgCount}img {groupCount}g</span>}
            </button>
          );
        })}
        <button
          onClick={() => onAddWorkspace && onAddWorkspace()}
          className="w-7 h-7 ml-1 rounded-full flex items-center justify-center bg-white border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors shadow-sm cursor-pointer"
          title="New Workspace"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto pl-[65px] pr-8 py-6 relative">
        {allJobs.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-black/20 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </div>
            <h3 className="text-lg font-semibold text-black mb-2">
              No images yet
            </h3>
            <p className="text-sm text-black/70 max-w-md">
              Upload garment images using the panel on the left. They&apos;ll appear here
              as they&apos;re processed and grouped into styles.
            </p>
          </div>
        ) : viewMode === "groups" ? (
          /* Groups view */
          <div>
            {/* Style groups */}
            {sortedGroups.length > 0 && (
              <div className="flex flex-wrap justify-center gap-5 mb-8">
                {sortedGroups.map((group) => (
                  <div key={group.id} className="w-[380px] flex-shrink-0">
                    <StyleGroup
                      group={group}
                      jobs={jobs}
                      onImageClick={handleImageClick}
                      onDropImage={handleDropImage}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Ungrouped images */}
            {ungroupedJobs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                  Ungrouped ({ungroupedJobs.length})
                </h3>
                <div className="flex flex-wrap justify-center gap-4">
                  {ungroupedJobs.map((job) => (
                    <div key={job.id} className="w-[180px] flex-shrink-0">
                      <ImageCard
                        job={job}
                        onClick={handleImageClick}
                        draggable={true}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No groups yet but images exist */}
            {sortedGroups.length === 0 && ungroupedJobs.length === 0 && allJobs.length > 0 && (
              <div className="text-center py-12">
                <div className="text-[var(--accent)] mb-3">
                  <svg className="w-10 h-10 mx-auto animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  Images are being processed. Groups will appear here.
                </p>
              </div>
            )}
          </div>
        ) : viewMode === "all" ? (
          /* All images grid */
          <div className="flex flex-wrap justify-center gap-4">
            {allJobs.map((job) => (
              <div key={job.id} className="w-[180px] flex-shrink-0">
                <ImageCard
                  job={job}
                  onClick={handleImageClick}
                  draggable={true}
                />
              </div>
            ))}
          </div>
        ) : (
          /* Ungrouped only */
          <div>
            {ungroupedJobs.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-4">
                {ungroupedJobs.map((job) => (
                  <div key={job.id} className="w-[180px] flex-shrink-0">
                    <ImageCard
                      job={job}
                      onClick={handleImageClick}
                      draggable={true}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-[var(--success)] mb-3">
                  <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  All images are grouped!
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail panel (slides in when an image is selected) */}
      {selectedJob && (
        <div className="absolute top-0 right-0 w-[320px] h-full bg-[var(--bg-secondary)] border-l border-[var(--border)] shadow-2xl overflow-y-auto animate-slide-in z-50">
          <div className="p-5">
            {/* Close button */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Image Details
              </h3>
              <button
                onClick={() => setSelectedJob(null)}
                className="w-7 h-7 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/20 flex items-center justify-center text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-colors cursor-pointer text-xs shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Image preview */}
            <div className="rounded-xl overflow-hidden mb-4 bg-[var(--bg-surface)] border border-[var(--border)]">
              <img
                src={getThumbnailUrl(selectedJob.id)}
                alt={selectedJob.filename}
                className="w-full h-auto object-contain max-h-[160px]"
              />
            </div>



            {/* Override Classification */}
            {selectedJob.classification && (
              <div className="mb-4 pb-4 border-b border-[var(--border)]">
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Override Classification</label>

                {/* Type selector */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {["FRONT", "BACK", "DETAIL", "SPEC_LABEL"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setOverrideForm(prev => ({ ...prev, image_type: t }))}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${(overrideForm?.image_type || selectedJob.image_type) === t
                          ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                          : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] shadow-sm"
                        }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Field inputs */}
                <div className="space-y-2">
                  <div>
                    <label className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Color</label>
                    <input
                      type="text"
                      defaultValue={selectedJob.classification?.dominant_color || ""}
                      onChange={e => setOverrideForm(prev => ({ ...prev, dominant_color: e.target.value }))}
                      placeholder="e.g. Navy Blue"
                      className="w-full mt-0.5 px-2 py-1 rounded-md border border-[var(--border)] bg-white text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Garment Type</label>
                    <input
                      type="text"
                      defaultValue={selectedJob.classification?.garment_type || ""}
                      onChange={e => setOverrideForm(prev => ({ ...prev, garment_type: e.target.value }))}
                      placeholder="e.g. polo shirt"
                      className="w-full mt-0.5 px-2 py-1 rounded-md border border-[var(--border)] bg-white text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">Pattern</label>
                    <input
                      type="text"
                      defaultValue={selectedJob.classification?.pattern || ""}
                      onChange={e => setOverrideForm(prev => ({ ...prev, pattern: e.target.value }))}
                      placeholder="e.g. solid"
                      className="w-full mt-0.5 px-2 py-1 rounded-md border border-[var(--border)] bg-white text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={async () => {
                    if (!confirm("Apply classification override?")) return;
                    try {
                      await overrideClassification(selectedJob.id, {
                        image_type: overrideForm?.image_type || selectedJob.image_type,
                        dominant_color: overrideForm?.dominant_color || selectedJob.classification?.dominant_color,
                        garment_type: overrideForm?.garment_type || selectedJob.classification?.garment_type,
                        pattern: overrideForm?.pattern || selectedJob.classification?.pattern,
                      });
                      setSelectedJob(prev => ({
                        ...prev,
                        image_type: overrideForm?.image_type || prev.image_type,
                        classification: {
                          ...prev.classification,
                          image_type: overrideForm?.image_type || prev.classification?.image_type,
                          dominant_color: overrideForm?.dominant_color || prev.classification?.dominant_color,
                          garment_type: overrideForm?.garment_type || prev.classification?.garment_type,
                          pattern: overrideForm?.pattern || prev.classification?.pattern,
                        }
                      }));
                    } catch (e) { console.error(e); }
                  }}
                  className="w-full mt-3 py-1.5 text-[11px] font-semibold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                >
                  Save Override
                </button>
              </div>
            )}

            {/* Info */}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Filename</label>
                <p className="text-sm text-[var(--text-primary)] font-mono mt-0.5">{selectedJob.filename}</p>
              </div>

              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Status</label>
                <div className="mt-1">
                  <span className={`status-badge status-${selectedJob.status}`}>
                    {selectedJob.status?.replace("_", " ")}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Type</label>
                <p className="text-sm text-[var(--text-primary)] mt-0.5">{selectedJob.image_type || "Unknown"}</p>
              </div>

              {selectedJob.classification && (
                <>
                  <div>
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Confidence</label>
                    <p className="text-sm text-[var(--text-primary)] font-mono mt-0.5">
                      {Math.round((selectedJob.classification.confidence || 0) * 100)}%
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Color</label>
                    <p className="text-sm text-[var(--text-primary)] mt-0.5">{selectedJob.classification.dominant_color}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Garment</label>
                    <p className="text-sm text-[var(--text-primary)] mt-0.5">{selectedJob.classification.garment_type}</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Pattern</label>
                    <p className="text-sm text-[var(--text-primary)] mt-0.5">{selectedJob.classification.pattern}</p>
                  </div>
                </>
              )}

              {selectedJob.spec_data && (
                <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
                  <h4 className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">Spec Data</h4>
                  <div className="space-y-1.5 text-xs">
                    {Object.entries(selectedJob.spec_data).map(([key, val]) => val && (
                      <div key={key} className="flex justify-between">
                        <span className="text-[var(--text-muted)] capitalize">{key.replace("_", " ")}</span>
                        <span className="text-[var(--text-primary)] font-mono text-right max-w-[180px] truncate">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedJob.style_group && (
                <div>
                  <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Style Group</label>
                  <p className="text-sm text-[var(--accent)] font-mono mt-0.5">{selectedJob.style_group}</p>
                </div>
              )}


              {/* Delete */}
              <div className="pt-3">
                <button
                  onClick={async () => {
                    if (confirm("Delete this image? This cannot be undone.")) {
                      try {
                        await deleteJob(selectedJob.id);
                        setSelectedJob(null);
                      } catch (e) { console.error(e); }
                    }
                  }}
                  className="w-full py-2 text-[11px] text-[var(--error)] bg-transparent border border-[var(--error)] rounded-lg hover:bg-[var(--error)] hover:text-white transition-colors cursor-pointer font-medium flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete Image
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewSlides && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-8 pb-8 bg-black/50 overflow-y-auto" onClick={() => setPreviewSlides(null)}>
          <div className="w-full max-w-4xl mx-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                <div>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">Catalog Preview</h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{previewSlides.length} slide{previewSlides.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => setPreviewSlides(null)} className="w-7 h-7 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/20 flex items-center justify-center text-[var(--error)] hover:bg-[var(--error)] hover:text-white transition-colors cursor-pointer text-xs">
                  ✕
                </button>
              </div>

              {/* Slides grid */}
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
                {previewSlides.map((slide, i) => (
                  <div key={i} className="bg-white rounded-lg border border-[var(--border)] overflow-hidden shadow-sm">
                    <div className="px-3 py-2 bg-[var(--bg-primary)] border-b border-[var(--border)] flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--text-primary)]">#{slide.style_number}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">Slide {i + 1}</span>
                    </div>
                    {slide.style_name && (
                      <div className="px-3 py-1.5 text-xs text-[var(--text-primary)] font-medium border-b border-[var(--border)]">{slide.style_name}</div>
                    )}
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {["front", "back", "detail", "spec_label"].filter(s => slide.slots[s]).map(slot => (
                        <div key={slot} className="text-center">
                          <div className="aspect-[3/4] bg-[var(--bg-primary)] rounded-md overflow-hidden border border-[var(--border)] mb-1">
                            <img
                              src={getThumbnailUrl(slide.slots[slot].job_id)}
                              alt={slot}
                              className="w-full h-full object-contain"
                              onError={e => { e.target.style.display = "none"; }}
                            />
                          </div>
                          <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{slot.replace("_", " ")}</span>
                          {slide.slots[slot].dominant_color && (
                            <div className="text-[8px] text-[var(--text-muted)] truncate">{slide.slots[slot].dominant_color}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
                <button onClick={() => setPreviewSlides(null)} className="px-4 py-1.5 text-xs font-semibold rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                  Close
                </button>
                <button
                  onClick={() => { setPreviewSlides(null); handleGenerate(); }}
                  className="px-4 py-1.5 text-xs font-semibold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                >
                  Generate Catalog
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
