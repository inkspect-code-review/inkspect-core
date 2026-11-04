import { isReviewReference, isKnowledgeReference, type ChatReference } from "./chat-review-evidence";

// Source markers in code, quotes, hidden HTML, escaped text and links are not
// evidence citations. IDs must also belong to this turn's authorized packet.
export function citedChatSources(content: string, sources: ChatReference[]): ChatReference[] {
  let fence: {character:string;length:number} | undefined;
  const lines = content.split("\n").filter(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return false;
    }
    if (marker) { fence = {character:marker[1][0],length:marker[1].length}; return false; }
    return true;
  });
  const prose = lines.join("\n")
    .replace(/^(?: {4}|\t| {0,3}>).*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "")
    .replace(/<!--[\s\S]*?-->|<[^>]*>/g, "")
    .replace(/!?\[[^\]\n]*\]\([^\n]*?\)/g, "")
    .replace(/\\\[/g, "");
  const used = new Set(Array.from(prose.matchAll(/\[([SRK][1-9]\d*)\]/g), match => match[1]));
  return sources.filter(source => used.has(source.id)).map(source => {
    if(isReviewReference(source)||isKnowledgeReference(source))return source;
    const {id,repository,repositoryId,revision,path,startLine,endLine,url}=source;
    return {id,repository,repositoryId,revision,path,startLine,endLine,url};
  });
}
