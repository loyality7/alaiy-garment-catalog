"use client";

import { useState, useRef, useCallback } from "react";
import { uploadFiles } from "../utils/api";

/**
 * UploadZone — drag-drop or file picker for uploading garment images.
 * Shows upload progress per file. Accepts jpg, png, jpeg.
 *
 * @param {{ onUploadComplete?: function }} props
 */
export default function UploadZone({ onUploadComplete }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const fileInputRef = useRef(null);

  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/jpg", "image/webp"];

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

        <div className="text-3xl mb-2">
          {isDragOver ? "📥" : isUploading ? "⏳" : "📤"}
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
                {file.status === "done"
                  ? "✅"
                  : file.status === "error"
                  ? "❌"
                  : file.status === "uploading"
                  ? "⏳"
                  : "⏸️"}
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
