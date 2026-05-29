"use client";

import { useState, useMemo } from "react";
import { getThumbnailUrl } from "../utils/api";

/**
 * ImageCard — displays a single image with status badge, type label, and confidence.
 * Shows spec data for SPEC_LABEL type images.
 *
 * @param {{ job: object, onClick?: function, draggable?: boolean, onDragStart?: function }} props
 */
export default function ImageCard({ job, onClick, draggable = false, onDragStart }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Determine which image to show (prefer processed, fall back to original)
  const imageSrc = useMemo(() => {
    if (job.processed_path) {
      return getThumbnailUrl(job.id);
    }
    if (job.original_path) {
      return getThumbnailUrl(job.id);
    }
    return null;
  }, [job.id, job.processed_path, job.original_path]);

  const imageType = job.image_type || "UNKNOWN";
  const confidence = job.classification?.confidence;
  const status = job.status || "uploaded";
  const isActive = status === "classifying" || status === "processing";

  // Type label icon
  const typeIcons = {
    FRONT: "👕",
    BACK: "🔄",
    DETAIL: "🔍",
    SPEC_LABEL: "🏷️",
    UNKNOWN: "❓",
  };

  const handleDragStart = (e) => {
    if (onDragStart) {
      onDragStart(e, job);
    }
    e.dataTransfer.setData("text/plain", job.id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      className={`image-card relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] ${isActive ? "processing-ring" : ""}`}
      style={{ width: "100%" }}
      onClick={() => onClick?.(job)}
      draggable={draggable}
      onDragStart={handleDragStart}
    >
      {/* Image */}
      <div className="relative aspect-[4/5] bg-[var(--bg-surface)] overflow-hidden">
        {imageSrc && !imgError ? (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 bg-[var(--bg-card)]" style={{
                backgroundImage: "linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)",
                backgroundSize: "400px 100%",
                animation: "shimmer 1.5s infinite",
              }} />
            )}
            <img
              src={imageSrc}
              alt={job.filename || "Garment image"}
              className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
              loading="lazy"
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)] text-3xl">
            {typeIcons[imageType] || "📷"}
          </div>
        )}

        {/* Type badge (top left) */}
        {imageType !== "UNKNOWN" && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-black/60 backdrop-blur-sm text-white">
            {typeIcons[imageType]} {imageType.replace("_", " ")}
          </div>
        )}

        {/* Confidence score (top right) */}
        {confidence != null && confidence > 0 && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-md text-[10px] font-mono font-bold bg-black/60 backdrop-blur-sm text-white">
            {Math.round(confidence * 100)}%
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="p-2.5">
        {/* Filename */}
        <p className="text-[11px] text-[var(--text-secondary)] truncate mb-1.5" title={job.filename}>
          {job.filename || "Unknown"}
        </p>

        {/* Status badge */}
        <div className={`status-badge status-${status}`}>
          {status.replace("_", " ")}
        </div>

        {/* Classification details */}
        {job.classification && (
          <div className="mt-2 flex flex-wrap gap-1">
            {job.classification.dominant_color && (
              <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-[var(--bg-surface)] text-[var(--text-muted)]">
                {job.classification.dominant_color}
              </span>
            )}
            {job.classification.garment_type && (
              <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-[var(--bg-surface)] text-[var(--text-muted)]">
                {job.classification.garment_type}
              </span>
            )}
          </div>
        )}

        {/* Spec data (for SPEC_LABEL type) */}
        {job.spec_data && imageType === "SPEC_LABEL" && (
          <div className="mt-2 p-2 rounded-lg bg-[var(--bg-surface)] text-[10px] space-y-1">
            {job.spec_data.ref_number && (
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">REF</span>
                <span className="text-[var(--text-secondary)] font-mono">{job.spec_data.ref_number}</span>
              </div>
            )}
            {job.spec_data.fabric_composition && (
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Fabric</span>
                <span className="text-[var(--text-secondary)] text-right max-w-[120px] truncate">{job.spec_data.fabric_composition}</span>
              </div>
            )}
            {job.spec_data.gsm && (
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">GSM</span>
                <span className="text-[var(--text-secondary)] font-mono">{job.spec_data.gsm}</span>
              </div>
            )}
            {job.spec_data.date && (
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Date</span>
                <span className="text-[var(--text-secondary)] font-mono">{job.spec_data.date}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
