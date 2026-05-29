"use client";

import { useState, useCallback } from "react";
import useWebSocket from "@/hooks/useWebSocket";
import PipelinePanel from "@/components/PipelinePanel";
import Canvas from "@/components/Canvas";
import { getWsUrl, fetchJobs, fetchGroups, moveImage } from "@/utils/api";

export default function Home() {
  const [jobs, setJobs] = useState({});
  const [groups, setGroups] = useState({});

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((message) => {
    const { event, job_id, data } = message;

    switch (event) {
      case "initial_state":
        // Full state sync on connect
        if (data.jobs) setJobs(data.jobs);
        if (data.groups) setGroups(data.groups);
        break;

      case "job_update":
        // Single job updated
        if (data && data.id) {
          setJobs((prev) => ({
            ...prev,
            [data.id]: { ...prev[data.id], ...data },
          }));
        } else if (job_id && data) {
          setJobs((prev) => ({
            ...prev,
            [job_id]: { ...prev[job_id], ...data },
          }));
        }
        break;

      case "grouping_complete":
        // Style groups updated
        if (data.groups) {
          setGroups(data.groups);
        }
        // Refresh jobs to get updated style_group assignments
        refreshJobs();
        break;

      case "catalog_complete":
        // Refresh all state
        refreshJobs();
        break;

      case "image_moved":
        // Re-fetch groups after manual move
        refreshGroups();
        if (data.job) {
          setJobs((prev) => ({
            ...prev,
            [data.job.id]: { ...prev[data.job.id], ...data.job },
          }));
        }
        break;

      case "pipeline_reset":
        setJobs({});
        setGroups({});
        break;

      case "job_deleted":
        if (job_id) {
          setJobs((prev) => {
            const next = { ...prev };
            delete next[job_id];
            return next;
          });
          refreshGroups();
        }
        break;

      case "grouping_started":
      case "catalog_started":
        // Status events — UI can react if needed
        break;

      case "pong":
        break;

      default:
        console.log("[WS] Unknown event:", event);
    }
  }, []);

  const { isConnected } = useWebSocket(getWsUrl(), handleMessage);

  // Fetch helpers (fallback when WebSocket state might be stale)
  const refreshJobs = async () => {
    try {
      const data = await fetchJobs();
      if (data.jobs) setJobs(data.jobs);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  };

  const refreshGroups = async () => {
    try {
      const data = await fetchGroups();
      if (data.groups) setGroups(data.groups);
    } catch (err) {
      console.error("Failed to fetch groups:", err);
    }
  };

  const handleUploadComplete = () => {
    // Jobs will arrive via WebSocket, but fetch as backup
    setTimeout(refreshJobs, 500);
  };

  const handleDropImage = async (jobId, targetGroupId) => {
    try {
      await moveImage(jobId, targetGroupId);
    } catch (err) {
      console.error("Move image error:", err);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden relative">
      <PipelinePanel
        jobs={jobs}
        groups={groups}
        isConnected={isConnected}
        onUploadComplete={handleUploadComplete}
      />
      <Canvas
        jobs={jobs}
        groups={groups}
        onDropImage={handleDropImage}
      />
    </div>
  );
}
