"use client";

/**
 * @param {{ onTogglePanel: function, activeView: string | null, isProcessing: boolean, showFlaggedOnly: boolean, onToggleFlagged: function }} props
 */
export default function FloatingToolbar({ onTogglePanel, activeView, isProcessing, showFlaggedOnly, onToggleFlagged }) {
  return (
    <div className="absolute left-1 md:left-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 md:gap-2 p-1 md:p-2 rounded-lg md:rounded-xl bg-white/80 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] border border-white/60 z-50">
      
      {/* Pointer (Active state for aesthetics) */}
      <button className={`w-7 h-7 md:w-9 md:h-9 rounded-[8px] md:rounded-[10px] shadow-md flex items-center justify-center border border-black/10 transition-transform hover:scale-105 tooltip ${!activeView ? "bg-[var(--accent)] text-white" : "bg-white text-black hover:text-[var(--accent)]"}`} data-tooltip="Select">
        <svg className="w-3.5 h-3.5 md:w-4.5 md:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
      </button>

      <div className="w-4 md:w-6 h-px bg-black/10" />

      {/* Upload Images Panel */}
      <button 
        onClick={() => !isProcessing && onTogglePanel("upload")}
        disabled={isProcessing}
        className={`w-7 h-7 md:w-9 md:h-9 rounded-[8px] md:rounded-[10px] flex items-center justify-center transition-all tooltip ${activeView === "upload" ? "bg-[var(--accent)] text-white shadow-lg scale-105" : "bg-white text-black hover:text-[var(--accent)] hover:shadow-md border border-transparent hover:border-black/5"} ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
        data-tooltip={isProcessing ? "Processing..." : "Upload Images"}
      >
        <svg className="w-3.5 h-3.5 md:w-4.5 md:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
      </button>

      {/* Stats Dashboard Panel */}
      <button 
        onClick={() => onTogglePanel("stats")}
        className={`w-7 h-7 md:w-9 md:h-9 rounded-[8px] md:rounded-[10px] flex items-center justify-center transition-all tooltip ${activeView === "stats" ? "bg-[var(--accent)] text-white shadow-lg scale-105" : "bg-white text-black hover:text-[var(--accent)] hover:shadow-md border border-transparent hover:border-black/5"}`}
        data-tooltip="Pipeline Stats"
      >
        <svg className="w-3.5 h-3.5 md:w-4.5 md:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
      </button>

      <div className="w-4 md:w-6 h-px bg-black/10" />

      {/* Triage Mode Toggle */}
      <button 
        onClick={() => onToggleFlagged && onToggleFlagged()}
        className={`w-7 h-7 md:w-9 md:h-9 rounded-[8px] md:rounded-[10px] flex items-center justify-center transition-all tooltip ${showFlaggedOnly ? "bg-[var(--error)]/10 text-[var(--error)] shadow-lg scale-105 border border-[var(--error)]/30" : "bg-white text-black hover:text-[var(--text-primary)] hover:shadow-md border border-transparent hover:border-black/5"}`}
        data-tooltip={showFlaggedOnly ? "Showing Flagged" : "Triage Mode"}
      >
        <svg className="w-3.5 h-3.5 md:w-4.5 md:h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
      </button>
      
    </div>
  );
}
