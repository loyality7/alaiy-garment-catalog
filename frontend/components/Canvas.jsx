"use client";

import { useMemo, useState } from "react";
import StyleGroup from "./StyleGroup";
import ImageCard from "./ImageCard";
import { getThumbnailUrl, deleteJob, overrideClassification } from "../utils/api";

/**
 * Canvas — main workspace area that displays style groups as clusters
 * and ungrouped images. Whiteboard-style layout.
 *
 * @param {{ jobs: object, groups: object, onDropImage?: function }} props
 */
export default function Canvas({ jobs, groups, onDropImage }) {
  const [selectedJob, setSelectedJob] = useState(null);
  const [viewMode, setViewMode] = useState("groups"); // "groups" | "all" | "ungrouped"

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
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-[var(--bg-primary)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Workspace
          </h2>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">
            {allJobs.length} images · {sortedGroups.length} groups
          </span>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-card)]">
          {[
            { key: "groups", label: "Groups", icon: "📂" },
            { key: "all", label: "All", icon: "🖼️" },
            { key: "ungrouped", label: "Ungrouped", icon: "❓" },
          ].map((mode) => (
            <button
              key={mode.key}
              onClick={() => setViewMode(mode.key)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all border-none cursor-pointer ${
                viewMode === mode.key
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] bg-transparent"
              }`}
            >
              {mode.icon} {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-5">
        {allJobs.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-6xl mb-4 opacity-30">👔</div>
            <h3 className="text-lg font-semibold text-[var(--text-secondary)] mb-2">
              No images yet
            </h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md">
              Upload garment images using the panel on the left. They&apos;ll appear here
              as they&apos;re processed and grouped into styles.
            </p>
          </div>
        ) : viewMode === "groups" ? (
          /* Groups view */
          <div>
            {/* Style groups */}
            {sortedGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                {sortedGroups.map((group) => (
                  <StyleGroup
                    key={group.id}
                    group={group}
                    jobs={jobs}
                    onImageClick={handleImageClick}
                    onDropImage={handleDropImage}
                  />
                ))}
              </div>
            )}

            {/* Ungrouped images */}
            {ungroupedJobs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                  Ungrouped ({ungroupedJobs.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {ungroupedJobs.map((job) => (
                    <ImageCard
                      key={job.id}
                      job={job}
                      onClick={handleImageClick}
                      draggable={true}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* No groups yet but images exist */}
            {sortedGroups.length === 0 && ungroupedJobs.length === 0 && allJobs.length > 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3 opacity-40">⏳</div>
                <p className="text-sm text-[var(--text-muted)]">
                  Images are being processed. Groups will appear here.
                </p>
              </div>
            )}
          </div>
        ) : viewMode === "all" ? (
          /* All images grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {allJobs.map((job) => (
              <ImageCard
                key={job.id}
                job={job}
                onClick={handleImageClick}
                draggable={true}
              />
            ))}
          </div>
        ) : (
          /* Ungrouped only */
          <div>
            {ungroupedJobs.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {ungroupedJobs.map((job) => (
                  <ImageCard
                    key={job.id}
                    job={job}
                    onClick={handleImageClick}
                    draggable={true}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3 opacity-40">✅</div>
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
        <div className="absolute top-0 right-0 w-[380px] h-full bg-[var(--bg-secondary)] border-l border-[var(--border)] shadow-2xl overflow-y-auto animate-slide-in z-50">
          <div className="p-5">
            {/* Close button */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                Image Details
              </h3>
              <button
                onClick={() => setSelectedJob(null)}
                className="w-7 h-7 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-xs"
              >
                ✕
              </button>
            </div>

            {/* Image preview */}
            <div className="rounded-xl overflow-hidden mb-4 bg-[var(--bg-surface)] border border-[var(--border)]">
              <img
                src={getThumbnailUrl(selectedJob.id)}
                alt={selectedJob.filename}
                className="w-full h-auto object-contain max-h-[300px]"
              />
            </div>

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

              {/* Reclassify */}
              {selectedJob.classification && (
                <div className="pt-3 border-t border-[var(--border)]">
                  <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Override Type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {["FRONT", "BACK", "DETAIL", "SPEC_LABEL"].map((t) => (
                      <button
                        key={t}
                        onClick={async () => {
                          try {
                            await overrideClassification(selectedJob.id, { image_type: t });
                          } catch (e) { console.error(e); }
                        }}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                          selectedJob.image_type === t
                            ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                            : "bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
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
                  className="w-full py-2 text-[11px] text-[var(--error)] bg-transparent border border-[var(--error)] rounded-lg hover:bg-[var(--error)] hover:text-white transition-colors cursor-pointer font-medium"
                >
                  🗑️ Delete Image
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
