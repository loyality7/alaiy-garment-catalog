/* eslint-disable @next/next/no-img-element */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useState, useMemo, useRef } from "react";
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
  const [isExpanded, setIsExpanded] = useState(false);
  const imgRef = useRef(null);

  // Cleanup ghost image on unmount
  useEffect(() => {
    return () => {
      const clone = document.getElementById("custom-drag-ghost");
      if (clone) clone.remove();
    };
  }, []);

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
    FRONT: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4h10l3 5-2 1v10H6V10L4 9l3-5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v1a3 3 0 006 0V4" /></svg>,
    BACK: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4h10l3 5-2 1v10H6V10L4 9l3-5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4h6" /></svg>,
    DETAIL: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>,
    SPEC_LABEL: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>,
    UNKNOWN: <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  };

  const handleDragStart = (e) => {
    if (onDragStart) {
      onDragStart(e, job);
    }
    e.dataTransfer.setData("text/plain", job.id);
    e.dataTransfer.effectAllowed = "move";

    // Hide native browser ghost image reliably (must be in DOM for Chrome)
    const ghostHider = document.createElement("div");
    ghostHider.style.position = "absolute";
    ghostHider.style.top = "-1000px";
    ghostHider.style.width = "1px";
    ghostHider.style.height = "1px";
    document.body.appendChild(ghostHider);
    e.dataTransfer.setDragImage(ghostHider, 0, 0);
    setTimeout(() => {
      if (ghostHider.parentNode) ghostHider.parentNode.removeChild(ghostHider);
    }, 100);

    // Create 100% opacity custom ghost
    if (imgRef.current) {
      const existingGhost = document.getElementById("custom-drag-ghost");
      if (existingGhost) existingGhost.remove();

      const clone = imgRef.current.cloneNode(true);
      clone.id = "custom-drag-ghost";
      clone.style.position = "fixed";
      clone.style.pointerEvents = "none";
      clone.style.zIndex = "99999";
      clone.style.width = `${imgRef.current.offsetWidth}px`;
      clone.style.height = `${imgRef.current.offsetHeight}px`;
      clone.style.boxShadow = "0 20px 25px -5px rgba(0, 0, 0, 0.3)";
      clone.style.borderRadius = "8px";
      clone.style.opacity = "1";
      
      const rect = imgRef.current.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      clone.dataset.offsetX = offsetX;
      clone.dataset.offsetY = offsetY;
      
      clone.style.left = `${e.clientX - offsetX}px`;
      clone.style.top = `${e.clientY - offsetY}px`;
      
      document.body.appendChild(clone);
    }
  };

  const handleDrag = (e) => {
    // e.clientX is 0 on the final drag tick before dragend
    if (e.clientX === 0 && e.clientY === 0) return; 
    const clone = document.getElementById("custom-drag-ghost");
    if (clone) {
      const offsetX = parseFloat(clone.dataset.offsetX);
      const offsetY = parseFloat(clone.dataset.offsetY);
      clone.style.left = `${e.clientX - offsetX}px`;
      clone.style.top = `${e.clientY - offsetY}px`;
    }
  };

  const handleDragEnd = (e) => {
    const clone = document.getElementById("custom-drag-ghost");
    if (clone) clone.remove();
  };

  return (
    <div
      className={`image-card relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] transition-all duration-200 ${
        isActive ? "processing-scan" : "hover:border-[var(--text-secondary)] hover:shadow-md"
      } ${draggable ? "cursor-grab active:cursor-grabbing hover:-translate-y-1" : ""}`}
      style={{ width: "100%" }}
      onClick={() => onClick?.(job)}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
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
              ref={imgRef}
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
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8.5px] font-bold uppercase tracking-wider bg-white/95 backdrop-blur-md text-[var(--text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-[var(--border)] flex items-center gap-1 transition-transform hover:scale-105">
            <span className="text-[var(--text-secondary)]">{typeIcons[imageType]}</span>
            {imageType.replace("_", " ")}
          </div>
        )}

        {/* Confidence score (top right) */}
        {confidence != null && confidence > 0 && (
          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[8.5px] font-mono font-bold bg-white/95 backdrop-blur-md text-[var(--text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.12)] border border-[var(--border)]">
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
          <div className="mt-2">
            <button 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
              className="w-full text-left py-1.5 px-2 rounded-md bg-[var(--bg-surface)] text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center justify-between"
            >
              <span>View Details</span>
              <svg className={`w-3 h-3 transform transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {isExpanded && (
              <div className="mt-1 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[10px] space-y-1 animate-fade-in">
                {job.spec_data.ref_number && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">REF</span>
                    <span className="text-[var(--text-secondary)] font-mono">{job.spec_data.ref_number}</span>
                  </div>
                )}
                {job.spec_data.fabric_composition && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Fabric</span>
                    <span className="text-[var(--text-secondary)] text-right max-w-[120px] truncate" title={job.spec_data.fabric_composition}>{job.spec_data.fabric_composition}</span>
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
        )}
      </div>
    </div>
  );
}
