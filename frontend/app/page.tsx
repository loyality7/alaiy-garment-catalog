"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import useWebSocket from "@/hooks/useWebSocket";
import PipelinePanel from "@/components/PipelinePanel";
import Canvas from "@/components/Canvas";
import FloatingToolbar from "@/components/FloatingToolbar";
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
    setActiveView(null);
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

  const [activeView, setActiveView] = useState(null); // 'upload', 'stats', or null

  const handleTogglePanel = (view) => {
    setActiveView(activeView === view ? null : view);
  };

  const isProcessing = useMemo(() => {
    return Object.values(jobs).some(job => 
      ["uploaded", "classifying", "classified", "processing"].includes(job.status)
    );
  }, [jobs]);

  // Derive Workspaces based on upload time gaps (> 60s)
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [manualWorkspaceCount, setManualWorkspaceCount] = useState(0);

  const workspaces = useMemo(() => {
    const allJobs = Object.values(jobs).sort((a, b) => a.created_at - b.created_at);
    const spaces = [];
    let currentSpace = [];
    let lastTime = 0;

    for (const job of allJobs) {
      if (lastTime === 0 || (job.created_at - lastTime) > 60) {
        if (currentSpace.length > 0) spaces.push(currentSpace);
        currentSpace = [job];
      } else {
        currentSpace.push(job);
      }
      lastTime = job.created_at;
    }
    if (currentSpace.length > 0) spaces.push(currentSpace);
    
    const baseSpaces = spaces.length > 0 ? spaces : [[]];

    // Append manually created workspaces
    for (let i = 0; i < manualWorkspaceCount; i++) {
      baseSpaces.push([]);
    }
    return baseSpaces;
  }, [jobs, manualWorkspaceCount]);

  const [prevWorkspacesLen, setPrevWorkspacesLen] = useState(0);

  useEffect(() => {
    if (workspaces.length > prevWorkspacesLen && workspaces.length > 0) {
      // A new workspace was created (e.g. new upload batch), jump to it!
      setActiveWorkspaceIndex(workspaces.length - 1);
    } else if (activeWorkspaceIndex >= workspaces.length) {
      // Workspace was deleted (e.g. reset), jump to latest available
      setActiveWorkspaceIndex(Math.max(0, workspaces.length - 1));
    }
    setPrevWorkspacesLen(workspaces.length);
  }, [workspaces.length, activeWorkspaceIndex, prevWorkspacesLen]);

  // Filter jobs and groups for the active workspace
  const activeJobs = useMemo(() => {
    const activeList = workspaces[activeWorkspaceIndex] || [];
    const map = {};
    activeList.forEach(j => map[j.id] = j);
    return map;
  }, [workspaces, activeWorkspaceIndex]);

  const activeGroups = useMemo(() => {
    const map = {};
    const activeJobIds = new Set(Object.keys(activeJobs));
    
    Object.values(groups).forEach(g => {
      // Filter image_ids to only include images in the active workspace
      const filteredIds = (g.image_ids || []).filter(id => activeJobIds.has(id));
      if (filteredIds.length > 0) {
        // Clone group with filtered image_ids
        map[g.id] = {
          ...g,
          image_ids: filteredIds,
          // Only keep slot refs if they're in this workspace
          front_image_id: activeJobIds.has(g.front_image_id) ? g.front_image_id : null,
          back_image_id: activeJobIds.has(g.back_image_id) ? g.back_image_id : null,
          detail_image_id: activeJobIds.has(g.detail_image_id) ? g.detail_image_id : null,
          spec_label_id: activeJobIds.has(g.spec_label_id) ? g.spec_label_id : null,
        };
      }
    });
    return map;
  }, [groups, activeJobs]);

  return (
    <div className="flex h-screen w-screen overflow-hidden relative bg-[var(--bg-canvas)]">
      
      {/* Floating Toolbar (Left edge) */}
      <FloatingToolbar 
        onTogglePanel={handleTogglePanel}
        activeView={activeView}
        isProcessing={isProcessing}
      />

      {/* Floating Pipeline Panel Popover */}
      <div 
        className={`absolute top-1/2 -translate-y-1/2 transition-all duration-400 ease-out z-40 ${
          activeView ? "left-[65px] opacity-100 scale-100" : "left-[50px] opacity-0 scale-95 pointer-events-none"
        }`}
      >
        <div className="bg-white/85 backdrop-blur-2xl shadow-[0_24px_48px_rgba(0,0,0,0.12)] border border-white/60 rounded-3xl overflow-hidden h-auto max-h-[85vh] w-[320px]">
          <PipelinePanel
            jobs={jobs}
            groups={groups}
            isConnected={isConnected}
            onUploadComplete={handleUploadComplete}
            activeView={activeView}
            onToggle={() => setActiveView(null)}
          />
        </div>
      </div>
      
      {/* Main Canvas Area (Full width now) */}
      <div className="flex-1 h-full relative z-10 w-full flex flex-col">
        <Canvas
          jobs={activeJobs}
          groups={activeGroups}
          onDropImage={handleDropImage}
          isConnected={isConnected}
          isProcessing={isProcessing}
          workspaces={workspaces}
          activeWorkspaceIndex={activeWorkspaceIndex}
          onWorkspaceChange={setActiveWorkspaceIndex}
          onAddWorkspace={() => setManualWorkspaceCount(c => c + 1)}
        />
      </div>
    </div>
  );
}
