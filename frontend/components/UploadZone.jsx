"use client";

import { useState, useRef, useCallback } from "react";
import { uploadFiles, startProcessing } from "../utils/api";

/**
 * UploadZone — drag-drop or file picker for uploading garment images.
 * Shows upload progress per file. Accepts jpg, png, jpeg.
 *
 * @param {{ onUploadComplete?: function }} props
 */
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/jpg", "image/webp"];

export default function UploadZone({ onUploadComplete }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const fileInputRef = useRef(null);

  const handleFiles = useCallback(async (files) => {
    // Filter to accepted types
    const validFiles = Array.from(files).filter((f) =>
      ACCEPTED_TYPES.some((t) => f.type.startsWith(t.split("/")[0]))
    );

    if (validFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress(
      validFiles.map((f) => ({ name: f.name, progress: 0, status: "pending" }))
    );

    // Upload in batches of 5
    const batchSize = 5;

    for (let i = 0; i < validFiles.length; i += batchSize) {
      const batch = validFiles.slice(i, i + batchSize);

      const formData = new FormData();
      batch.forEach((file) => formData.append("files", file));

      try {
        // Update progress for this batch
        setUploadProgress((prev) =>
          prev.map((p, idx) => {
            if (idx >= i && idx < i + batchSize) {
              return { ...p, progress: 50, status: "uploading" };
            }
            return p;
          })
        );

        await uploadFiles(formData);

        // Mark batch as complete
        setUploadProgress((prev) =>
          prev.map((p, idx) => {
            if (idx >= i && idx < i + batchSize) {
              return { ...p, progress: 100, status: "done" };
            }
            return p;
          })
        );
      } catch (err) {
        console.error("Upload error:", err);
        setUploadProgress((prev) =>
          prev.map((p, idx) => {
            if (idx >= i && idx < i + batchSize) {
              return { ...p, status: "error" };
            }
            return p;
          })
        );
      }
    }

    setIsUploading(false);

    // Clear progress after 3 seconds
    setTimeout(() => {
      setUploadProgress([]);
    }, 3000);

    if (onUploadComplete) {
      onUploadComplete();
    }
    
    // Start processing the uploaded batch
    try {
      await startProcessing();
    } catch (err) {
      console.error("Failed to start processing", err);
    }
  }, [onUploadComplete]);

  // Drag handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={`upload-zone flex flex-col items-center justify-center p-6 text-center transition-all ${isDragOver ? "drag-over" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="text-[var(--accent)] mb-3">
          {isDragOver ? (
            <svg className="w-10 h-10 mx-auto animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          ) : isUploading ? (
            <svg className="w-10 h-10 mx-auto animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          ) : (
            <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          )}
        </div>

        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
          {isDragOver
            ? "Drop images here"
            : isUploading
            ? "Uploading..."
            : "Upload garment images"}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          Drag & drop or click · JPG, PNG · Multiple files
        </p>
      </div>

      {/* Upload progress */}
      {uploadProgress.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {uploadProgress.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 text-[11px] animate-fade-in"
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              <span className="flex-shrink-0">
                {file.status === "done" ? (
                  <svg className="w-3.5 h-3.5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                ) : file.status === "error" ? (
                  <svg className="w-3.5 h-3.5 text-[var(--error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                ) : file.status === "uploading" ? (
                  <svg className="w-3.5 h-3.5 text-[var(--accent)] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                )}
              </span>
              <span className="truncate flex-1 text-[var(--text-secondary)]">
                {file.name}
              </span>
              {file.status === "uploading" && (
                <div className="w-16 progress-bar">
                  <div
                    className="progress-bar-fill bg-[var(--accent)]"
                    style={{ width: `${file.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
