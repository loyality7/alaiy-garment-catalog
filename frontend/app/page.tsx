"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import useWebSocket from "@/hooks/useWebSocket";
import PipelinePanel from "@/components/PipelinePanel";
import Canvas from "@/components/Canvas";
import FloatingToolbar from "@/components/FloatingToolbar";
import { getWsUrl, fetchJobs, fetchGroups, moveImage } from "@/utils/api";

export interface Job {
  id: string;
  status: string;
  created_at: number;
  style_group?: string | null;
  workspace_id?: string;
}

export interface Group {
  id: string;
  image_ids?: string[];
  front_image_id?: string | null;
  back_image_id?: string | null;
  detail_image_id?: string | null;
  spec_label_id?: string | null;
  style_number?: number;
  workspace_id?: string;
}

interface MoveHistoryItem {
  jobId: string;
  from: string | null;
  to: string | null;
}

export default function Home() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [showReadyToast, setShowReadyToast] = useState(false);
  const [prevUnfinishedCount, setPrevUnfinishedCount] = useState(0);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  // Handle incoming WebSocket messages (now batched)
  const handleMessage = useCallback((messages: any[]) => {
    // Process all batched messages in a single state update frame
    if (!Array.isArray(messages)) return;
    
    // We can collect updates to apply them together if we want, but for now
    // looping through them and using the functional state updater (prev => ...)
    // handles it safely, even if it triggers multiple renders under the hood,
    // React 18 batches them!
    
    // We will just loop and use functional updates, since React 18 batches them
    // within the setInterval macro-task automatically.
    
    for (const message of messages) {
      const { event, job_id } = message;
      const data = message.data as Record<string, unknown>;

    switch (event) {
      case "initial_state":
        // Full state sync on connect
        if (data.jobs) setJobs(data.jobs as Record<string, Job>);
        if (data.groups) setGroups(data.groups as Record<string, Group>);
        break;

      case "job_update":
        // Single job updated
        if (data && data.id) {
          const dataId = data.id as string;
          setJobs((prev) => ({
            ...prev,
            [dataId]: { ...prev[dataId], ...(data as unknown as Job) },
          }));
        } else if (job_id && data) {
          setJobs((prev) => ({
            ...prev,
            [job_id]: { ...prev[job_id], ...(data as unknown as Job) },
          }));
        }
        break;

      case "groups_update":
        // Full groups object updated
        if (data) {
          setGroups(data as Record<string, Group>);
        }
        break;

      case "grouping_complete":
      case "grouping_failed":
        // Style groups updated
        if (data && data.groups) {
          setGroups(data.groups as Record<string, Group>);
        }
        // Refresh jobs to get updated style_group assignments
        refreshJobs();
        window.dispatchEvent(new Event("grouping_finished"));
        break;

      case "catalog_complete":
        // Refresh all state
        refreshJobs();
        break;

      case "image_moved":
        // Re-fetch groups after manual move
        refreshGroups();
        if (data && data.job) {
          const movedJob = data.job as Job;
          setJobs((prev) => ({
            ...prev,
            [movedJob.id]: { ...prev[movedJob.id], ...movedJob },
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
    }
  }, []);

  const { isConnected } = useWebSocket(getWsUrl(), handleMessage);

  // Fetch helpers (fallback when WebSocket state might be stale)
  async function refreshJobs() {
    try {
      const data = await fetchJobs();
      if (data.jobs) setJobs(data.jobs as Record<string, Job>);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }

  async function refreshGroups() {
    try {
      const data = await fetchGroups();
      if (data.groups) setGroups(data.groups as Record<string, Group>);
    } catch (err) {
      console.error("Failed to fetch groups:", err);
    }
  }

  const handleUploadComplete = () => {
    // Jobs will arrive via WebSocket, but fetch as backup
    setTimeout(refreshJobs, 500);
    setActiveView(null);
  };

  const [moveHistory, setMoveHistory] = useState<MoveHistoryItem[]>([]);
  const [redoHistory, setRedoHistory] = useState<MoveHistoryItem[]>([]);

  const handleDropImage = async (jobId: string, targetGroupId: string | null) => {
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
    const handleKeyDown = async (e: KeyboardEvent) => {
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

  // Monitor jobs to trigger "ready to group" popup
  useEffect(() => {
    const jobList = Object.values(jobs);
    if (jobList.length === 0) return;

    const doneStatuses = ["cleaned", "assigned", "ppt_ready", "failed"];
    const unfinished = jobList.filter(j => !doneStatuses.includes(j.status)).length;

    // If we previously had unfinished jobs, and now we have 0 unfinished jobs
    if (prevUnfinishedCount > 0 && unfinished === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowReadyToast(true);
      setTimeout(() => setShowReadyToast(false), 5000);
    }
    setPrevUnfinishedCount(unfinished);
  }, [jobs, prevUnfinishedCount]);

  const [activeView, setActiveView] = useState<string | null>(null); // 'upload', 'stats', or null

  const handleTogglePanel = (view: string | null) => {
    setActiveView(activeView === view ? null : view);
  };

  const isProcessing = useMemo(() => {
    return Object.values(jobs).some(job =>
      ["uploaded", "classifying", "classified", "processing"].includes(job.status)
    );
  }, [jobs]);

  // Derive Workspaces based on workspace_id
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [manualWorkspaceCount, setManualWorkspaceCount] = useState(0);

  const workspaces = useMemo(() => {
    const allJobs = Object.values(jobs).sort((a, b) => a.created_at - b.created_at);
    const spacesMap: Record<string, Job[]> = {};
    const workspaceOrder: string[] = [];

    for (const job of allJobs) {
      const wid = job.workspace_id || "default";
      if (!spacesMap[wid]) {
        spacesMap[wid] = [];
        workspaceOrder.push(wid);
      }
      spacesMap[wid].push(job);
    }
    
    const spaces = workspaceOrder.map(wid => spacesMap[wid]);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const map: Record<string, Job> = {};
    activeList.forEach(j => map[j.id] = j);
    return map;
  }, [workspaces, activeWorkspaceIndex]);

  const activeGroups = useMemo(() => {
    const map: Record<string, Group> = {};
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
          front_image_id: g.front_image_id && activeJobIds.has(g.front_image_id) ? g.front_image_id : null,
          back_image_id: g.back_image_id && activeJobIds.has(g.back_image_id) ? g.back_image_id : null,
          detail_image_id: g.detail_image_id && activeJobIds.has(g.detail_image_id) ? g.detail_image_id : null,
          spec_label_id: g.spec_label_id && activeJobIds.has(g.spec_label_id) ? g.spec_label_id : null,
        };
      }
    });
    return map;
  }, [groups, activeJobs]);

  return (
    <div className="flex h-screen w-screen overflow-hidden relative bg-[var(--bg-canvas)]">

      {/* Ready to Group Toast Popup */}
      <div className={`absolute top-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 transform ${showReadyToast ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0'}`}>
        <div className="bg-[#00d084] text-white mx-3 px-4 md:px-6 py-2 md:py-3 rounded-full shadow-lg font-medium flex items-center gap-2 md:gap-3 text-xs md:text-sm whitespace-nowrap">
          <svg className="w-4 md:w-5 h-4 md:h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          <span className="truncate">All images processed! Ready to group.</span>
          <button onClick={() => setShowReadyToast(false)} className="ml-1 md:ml-2 hover:bg-black/10 rounded-full p-1 transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Floating Toolbar (Left edge) */}
      <FloatingToolbar
        onTogglePanel={handleTogglePanel}
        activeView={activeView}
        isProcessing={isProcessing}
        showFlaggedOnly={showFlaggedOnly}
        onToggleFlagged={() => setShowFlaggedOnly(!showFlaggedOnly)}
      />

      {/* Floating Pipeline Panel Popover */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 transition-all duration-400 ease-out z-40 ${activeView ? "md:left-[65px] left-3 opacity-100 scale-100" : "-left-full md:left-[50px] opacity-0 scale-95 pointer-events-none"
          }`}
      >
        <div className="bg-white/85 backdrop-blur-2xl shadow-[0_24px_48px_rgba(0,0,0,0.12)] border border-white/60 md:rounded-3xl rounded-2xl overflow-hidden h-auto max-h-[85vh] w-[calc(100vw-24px)] md:w-[320px]">
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
          allGroups={groups}
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
