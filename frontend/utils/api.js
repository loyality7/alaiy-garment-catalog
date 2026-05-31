/**
 * API utility for frontend to talk to the FastAPI backend.
 * Uses Axios for all HTTP communication.
 */
import axios from 'axios';

// Determine base URL dynamically based on environment or .env
const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== "undefined") {
    return "";
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
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return "ws://localhost:8000/ws";
};

// Create the centralized Axios client
const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Response interceptor for centralized error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // You can handle global auth errors or toasts here
    console.error("API Error:", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

/**
 * Upload files to the backend
 */
export const uploadFiles = async (formData) => {
  const response = await apiClient.post("/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};

/**
 * Start processing uploaded files
 */
export const startProcessing = async () => {
  const response = await apiClient.post("/start_processing");
  return response.data;
};

/**
 * Fetch all jobs
 */
export const fetchJobs = async () => {
  const response = await apiClient.get("/jobs");
  return response.data;
};

/**
 * Fetch all style groups
 */
export const fetchGroups = async () => {
  const response = await apiClient.get("/groups");
  return response.data;
};

/**
 * Trigger grouping
 */
export const triggerGrouping = async () => {
  const response = await apiClient.post("/group");
  return response.data;
};

/**
 * Trigger catalog generation
 */
export const triggerGenerate = async (groupIds = null) => {
  const data = groupIds ? { group_ids: groupIds } : undefined;
  const response = await apiClient.post("/generate", data);
  return response.data;
};

export const fetchPreview = async (groupIds = null) => {
  const data = groupIds ? { group_ids: groupIds } : undefined;
  const response = await apiClient.post("/preview", data);
  return response.data;
};

/**
 * Move image between groups
 */
export const moveImage = async (jobId, targetGroupId) => {
  const response = await apiClient.post("/move-image", null, {
    params: {
      job_id: jobId,
      target_group_id: targetGroupId,
    }
  });
  return response.data;
};

/**
 * Reset pipeline
 */
export const resetPipeline = async () => {
  const response = await apiClient.post("/reset");
  return response.data;
};

/**
 * Scan input folder for local images
 */
export const scanInputFolder = async () => {
  const response = await apiClient.post("/scan");
  return response.data;
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
  const response = await apiClient.delete(`/job/${jobId}`);
  return response.data;
};

/**
 * Override classification for a job
 */
export const overrideClassification = async (jobId, { image_type, dominant_color, garment_type, pattern }) => {
  const params = { image_type };
  if (dominant_color) params.dominant_color = dominant_color;
  if (garment_type) params.garment_type = garment_type;
  if (pattern) params.pattern = pattern;

  const response = await apiClient.patch(`/job/${jobId}/classify`, null, { params });
  return response.data;
};
