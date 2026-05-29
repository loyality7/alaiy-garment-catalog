"use client";

import { useState, useCallback, useEffect } from "react";
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

  const [moveHistory, setMoveHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);

  const handleDropImage = async (jobId, targetGroupId) => {
    try {
      const job = jobs[jobId];
      const oldGroupId = job?.style_group || null;
      
      await moveImage(jobId, targetGroupId);
      
      setMoveHistory(prev => [...prev, { jobId, from: oldGroupId, to: targetGroupId }]);
      setRedoHistory([]);
    } catch (err) {
      console.error("Move image error:", err);
    }
  };

  // Keyboard shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (moveHistory.length > 0) {
          const lastMove = moveHistory[moveHistory.length - 1];
          await moveImage(lastMove.jobId, lastMove.from);
          setMoveHistory(prev => prev.slice(0, -1));
          setRedoHistory(prev => [...prev, lastMove]);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (redoHistory.length > 0) {
          const nextMove = redoHistory[redoHistory.length - 1];
          await moveImage(nextMove.jobId, nextMove.to);
          setRedoHistory(prev => prev.slice(0, -1));
          setMoveHistory(prev => [...prev, nextMove]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveHistory, redoHistory]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden relative bg-[var(--bg-canvas)]">
      {/* Sidebar Container with smooth width transition */}
      <div 
        className={`relative transition-all duration-300 ease-in-out h-full z-20 ${
          isSidebarOpen ? "w-[300px]" : "w-0"
        }`}
      >
        <div className={`absolute top-0 left-0 w-[300px] h-full shadow-2xl transition-transform duration-300 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <PipelinePanel
            jobs={jobs}
            groups={groups}
            isConnected={isConnected}
            onUploadComplete={handleUploadComplete}
            isSidebarOpen={isSidebarOpen}
            onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          />
        </div>
      </div>
      
      {/* Main Canvas Area */}
      <div className="flex-1 h-full relative z-10 transition-all duration-300">
        <Canvas
          jobs={jobs}
          groups={groups}
          onDropImage={handleDropImage}
          isSidebarOpen={isSidebarOpen}
          onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      </div>
    </div>
  );
}
