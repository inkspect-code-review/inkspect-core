import { brandMarkPng } from "./brand-mark";
import { magicLinkTemplate } from "./magic-link-template";

const markContentId = "inkspect-sign-in-mark";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function magicLinkEmailContent(url: string) {
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) ||
    parsed.username || parsed.password || /[\r\n]/.test(url)) {
    throw new Error("Invalid sign-in email URL.");
  }
  return {
    subject: "Sign in to Inkspect",
    text: `Sign in to Inkspect\n\nUse this link to sign in:\n${url}\n\nThis link expires in 10 minutes and can be used once.\nIf you did not request it, you can ignore this email.`,
    html: magicLinkTemplate
      .replaceAll("{{logoUrl}}", `cid:${markContentId}`)
      .replaceAll("{{signInUrl}}", escapeHtml(url)),
    attachments: [{
      filename: "inkspect-mark.png",
      content: Buffer.from(brandMarkPng, "base64"),
      contentType: "image/png",
      contentDisposition: "inline" as const,
      cid: markContentId,
    }],
  };
}
