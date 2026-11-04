export type RepositoryIndexFreshness = { up_to_date: boolean; revision?: string; check_failed?: boolean };
export type RepositoryIndexEligibility = { size_bytes: number | null; limit_bytes: number; allowed: boolean; support_required: boolean; reason?: string };
export type RepositoryIndex = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  progress: {
    stage: string;
    analyze_only?: boolean;
    cleanup_pending?: boolean;
    revision?: string;
    branch?: string;
    scan: { measured?: boolean; stage: string; total: number; processed: number; read: number; chunks: number; skipped: number };
    chunks: number;
    embedded: number;
    reused: number;
    indexed: boolean;
    partial?: boolean;
    skipped?: number;
    omissions?: { path: string; reason: string }[];
    support_required?: boolean;
    repository_size_bytes?: number;
    error?: string;
    /** Stable engine code for failures users can fix, e.g. "source.invalid_ignore". */
    error_code?: string;
    summary?: { purpose: string; architecture: string[]; technologies: string[]; evidence: string[]; model: string; sampled: boolean };
    logs: { key?: string; at: string; message: string }[];
  };
};
