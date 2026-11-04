import type { ChatSource } from "./chat-context";
import type { ReviewReport } from "./review-types";

export type ChatReviewReference = {
 kind:"review";id:string;repository:string;repositoryId:number;revision:string;url:string;
 jobId:string;createdAt:string;pullNumber:number;diagram?:NonNullable<ReviewReport["diagram"]>;
};
export type ChatKnowledgeReference={kind:"knowledge";id:string;documentId:string;title:string;digest:string;startLine:number;endLine:number;url:string};
export type ChatKnowledgeResult={status:"available"|"unavailable";total:number;documents:{reference:ChatKnowledgeReference;content:string;truncated:boolean}[];incomplete:boolean};
export type ChatReference = Omit<ChatSource,"content"> | ChatReviewReference | ChatKnowledgeReference;
export const isKnowledgeReference = (source:ChatReference):source is ChatKnowledgeReference => "kind" in source && source.kind==="knowledge";
export const isReviewReference = (source:ChatReference):source is ChatReviewReference => "kind" in source && source.kind==="review";
export type ChatReviewEvidence = {
 reference:ChatReviewReference;summary:string;decision:string;findings:ReviewReport["findings"];
 findingCount:number;truncated:boolean;coverageComplete:boolean;freshness:string;diagramAvailable:boolean;
};
export type ChatReviewResult = {repository:string;status:"available"|"empty"|"unavailable";latestJob?:{id:string;status:string;createdAt:string};searchedRecent:number;historyLimited:boolean;reviews:ChatReviewEvidence[]};

// Only structured graph data reaches the SVG renderer, never model HTML/SVG/JS.
export function safeReviewDiagram(value:unknown):NonNullable<ReviewReport["diagram"]>|undefined {
 if(!value || typeof value!=="object")return;
 const d=value as NonNullable<ReviewReport["diagram"]>;
 if(typeof d.title!=="string" || d.title.length>300 || !["current","proposed"].includes(d.view) || !Array.isArray(d.nodes) || !d.nodes.length || d.nodes.length>60 || !Array.isArray(d.edges) || d.edges.length>120)return;
 if(d.nodes.some(n=>!n || typeof n.id!=="string" || n.id.length>100 || typeof n.label!=="string" || n.label.length>500))return;
 const ids=new Set(d.nodes.map(n=>n.id));if(ids.size!==d.nodes.length)return;
 if(d.edges.some(e=>!e || !ids.has(e.from) || !ids.has(e.to) || (e.label!==undefined && (typeof e.label!=="string" || e.label.length>500))))return;
 return {title:d.title,view:d.view,nodes:d.nodes.map(n=>({id:n.id,label:n.label,issue:n.issue===true})),edges:d.edges.map(e=>({from:e.from,to:e.to,...(e.label?{label:e.label}:{}),missing:e.missing===true}))};
}
