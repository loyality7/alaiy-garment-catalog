/**
 * API utility for frontend to talk to the FastAPI backend.
 * Bypasses Next.js proxy to avoid body size limits for large files.
 */

// Determine base URL dynamically based on environment or .env
const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
};

export const API_BASE_URL = getBaseUrl();

/**
 * Get the WebSocket URL for the backend
 */
export const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  if (typeof window !== "undefined") {
    return `ws://${window.location.hostname}:8000/ws`;
  }
  return "ws://localhost:8000/ws";
};

/**
 * Upload files to the backend
 */
export const uploadFiles = async (formData) => {
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  return response.json();
};

/**
 * Fetch all jobs
 */
export const fetchJobs = async () => {
  const response = await fetch(`${API_BASE_URL}/jobs`);
  if (!response.ok) throw new Error("Failed to fetch jobs");
  return response.json();
};

/**
 * Fetch all style groups
 */
export const fetchGroups = async () => {
  const response = await fetch(`${API_BASE_URL}/groups`);
  if (!response.ok) throw new Error("Failed to fetch groups");
  return response.json();
};

/**
 * Trigger grouping
 */
export const triggerGrouping = async () => {
  const response = await fetch(`${API_BASE_URL}/group`, { method: "POST" });
  if (!response.ok) throw new Error("Grouping failed");
  return response.json();
};

/**
 * Trigger catalog generation
 */
export const triggerGenerate = async (groupIds = null) => {
  const options = { method: "POST" };
  if (groupIds) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ group_ids: groupIds });
  }
  const response = await fetch(`${API_BASE_URL}/generate`, options);
  if (!response.ok) throw new Error("Generation failed");
  return response.json();
};

export const fetchPreview = async () => {
  const response = await fetch(`${API_BASE_URL}/preview`);
  if (!response.ok) throw new Error("Failed to fetch preview");
  return response.json();
};

/**
 * Move image between groups
 */
export const moveImage = async (jobId, targetGroupId) => {
  const response = await fetch(
    `${API_BASE_URL}/move-image?job_id=${jobId}&target_group_id=${targetGroupId}`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error("Failed to move image");
  return response.json();
};

/**
 * Reset pipeline
 */
export const resetPipeline = async () => {
  const response = await fetch(`${API_BASE_URL}/reset`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to reset");
  return response.json();
};

/**
 * Scan input folder for local images
 */
export const scanInputFolder = async () => {
  const response = await fetch(`${API_BASE_URL}/scan`, { method: "POST" });
  if (!response.ok) throw new Error("Failed to scan folder");
  return response.json();
};

/**
 * Get image thumbnail URL
 */
export const getThumbnailUrl = (jobId) => {
  return `${API_BASE_URL}/thumbnail/${jobId}`;
};

/**
 * Get catalog download URL
 */
export const getDownloadUrl = () => {
  return `${API_BASE_URL}/download`;
};

/**
 * Delete a job
 */
export const deleteJob = async (jobId) => {
  const response = await fetch(`${API_BASE_URL}/job/${jobId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Failed to delete job");
  return response.json();
};

/**
 * Override classification for a job
 */
export const overrideClassification = async (jobId, { image_type, dominant_color, garment_type, pattern }) => {
  const params = new URLSearchParams({ image_type });
  if (dominant_color) params.append("dominant_color", dominant_color);
  if (garment_type) params.append("garment_type", garment_type);
  if (pattern) params.append("pattern", pattern);

  const response = await fetch(`${API_BASE_URL}/job/${jobId}/classify?${params}`, { method: "PATCH" });
  if (!response.ok) throw new Error("Failed to override classification");
  return response.json();
};
