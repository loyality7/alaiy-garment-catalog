"use client";

import { useState, useMemo } from "react";
import ImageCard from "./ImageCard";

/**
 * StyleGroup — container for one garment style, showing all images in that group.
 * Highlights when any image in the group is being processed.
 * Supports drag-and-drop to receive images from other groups.
 *
 * @param {{ group: object, jobs: object, onImageClick?: function, onDropImage?: function }} props
 */
export default function StyleGroup({ group, jobs, onImageClick, onDropImage }) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Get all jobs in this group
  const groupJobs = useMemo(() => {
    if (!group.image_ids) return [];
    return group.image_ids
      .map((id) => jobs[id])
      .filter(Boolean);
  }, [group.image_ids, jobs]);

  // Check if any image in group is actively processing
  const isProcessing = useMemo(() => {
    return groupJobs.some(
      (j) => j.status === "classifying" || j.status === "processing"
    );
  }, [groupJobs]);

  // Slot indicators (which image types are filled)
  const slots = useMemo(() => ({
    front: group.front_image_id ? jobs[group.front_image_id] : null,
    back: group.back_image_id ? jobs[group.back_image_id] : null,
    detail: group.detail_image_id ? jobs[group.detail_image_id] : null,
    spec: group.spec_label_id ? jobs[group.spec_label_id] : null,
  }), [group, jobs]);

  const filledSlots = Object.values(slots).filter(Boolean).length;

  // Drag-and-drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const jobId = e.dataTransfer.getData("text/plain");
    if (jobId && onDropImage) {
      onDropImage(jobId, group.id);
    }
  };

  // Determine if group needs review
  const getWarningBorder = () => {
    const fronts = groupJobs.filter(j => j.image_type === "FRONT").length;
    const backs = groupJobs.filter(j => j.image_type === "BACK").length;
    
    if (fronts === 0) return "border-red-500 border-2";
    if (groupJobs.length === 1) return "border-yellow-500 border-2";
    if (fronts > 1 || backs > 1) return "border-orange-500 border-2";
    return "";
  };

  return (
    <div
      className={`style-group p-4 animate-scale-in ${getWarningBorder()} ${isProcessing ? "is-processing" : ""} ${isDragOver ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          {/* Style number */}
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent)] text-xs font-bold">
            {group.style_number || "?"}
          </span>

          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
              {group.name || `Style ${group.style_number || "?"}`}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              {group.garment_type && <span>{group.garment_type}</span>}
              {group.dominant_color && <span> · {group.dominant_color}</span>}
              {group.pattern && group.pattern !== "solid" && <span> · {group.pattern}</span>}
            </p>
          </div>
        </div>

        {/* Slot indicators */}
        <div className="flex items-center gap-1">
          {["front", "back", "detail", "spec"].map((slot) => (
            <div
              key={slot}
              className={`tooltip w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold uppercase ${
                slots[slot]
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              }`}
              data-tooltip={`${slot.charAt(0).toUpperCase() + slot.slice(1)}: ${slots[slot] ? "✓" : "missing"}`}
            >
              {slot.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Spec data summary (if available) */}
      {group.spec_data && (
        <div className="mb-3 p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            {group.spec_data.ref_number && (
              <>
                <span className="text-[var(--text-muted)] font-medium">REF</span>
                <span className="text-[var(--text-secondary)] font-mono">{group.spec_data.ref_number}</span>
              </>
            )}
            {group.spec_data.fabric_composition && (
              <>
                <span className="text-[var(--text-muted)] font-medium">Content</span>
                <span className="text-[var(--text-secondary)] truncate">{group.spec_data.fabric_composition}</span>
              </>
            )}
            {group.spec_data.gsm && (
              <>
                <span className="text-[var(--text-muted)] font-medium">GSM</span>
                <span className="text-[var(--text-secondary)] font-mono">{group.spec_data.gsm}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Image grid */}
      <div className="grid grid-cols-2 gap-2">
        {groupJobs.map((job) => (
          <ImageCard
            key={job.id}
            job={job}
            onClick={onImageClick}
            draggable={true}
          />
        ))}
      </div>

      {/* Empty state */}
      {groupJobs.length === 0 && (
        <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-[var(--border)] text-[var(--text-muted)] text-xs">
          Drop images here
        </div>
      )}

      {/* Footer: image count */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)]">
          {groupJobs.length} image{groupJobs.length !== 1 ? "s" : ""} · {filledSlots}/4 slots
        </span>
        {isProcessing && (
          <span className="text-[10px] text-[var(--accent)] font-medium animate-pulse">
            Processing...
          </span>
        )}
      </div>
    </div>
  );
}
