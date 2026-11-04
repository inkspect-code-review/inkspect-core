import type { ReviewJob } from "./review-types";

// Never rely on the worker's response order. Invalid legacy timestamps go last.
export function newestReviews(rows: ReviewJob[]) {
  const timestamp = (row: ReviewJob) => {
    const value = Date.parse(row.job.created_at);
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...rows].sort((a, b) => timestamp(b) - timestamp(a) || b.job.id.localeCompare(a.job.id));
}

export function selectedReviewId(rows: ReviewJob[], current: string, linked?: string | null) {
  const sorted = newestReviews(rows);
  if (linked && sorted.some(row => row.job.id === linked)) return linked;
  return sorted.some(row => row.job.id === current) ? current : sorted[0]?.job.id || "";
}

// Findings can link to a review older than the engine's recent-history window.
export async function reviewsWithLinkedJob(rows: ReviewJob[], linked: { jobId: string; repositoryId: number } | null, read: () => Promise<ReviewJob>) {
  if (!linked || rows.some(row => row.job.id === linked.jobId)) return newestReviews(rows);
  const review = await read();
  if (review.job.id !== linked.jobId || review.snapshot.repository_id !== String(linked.repositoryId)) throw new Error("The linked review could not be loaded.");
  return newestReviews([...rows, review]);
}
