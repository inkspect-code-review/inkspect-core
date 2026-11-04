import { productFetch } from "./api-client";
import { reportBrowserError } from "./diagnostics/client";
export type LiveState = "connecting" | "live" | "reconnecting" | "unavailable";
type Options = { channel: string; organizationId: string; onRefresh: () => void; onActivity?: () => void; onIndex?: () => void; onState: (state: LiveState) => void; onMessage: (message: string) => void };

// Native protocol v2 is used here because SDK 0.2.3 does not surface the native
// channel-scoped subscription_error packet. The server uses the official SDK.
// Pubb events are hints; always refresh durable state after (re)subscription.
export function subscribeReviews(options: Options, createSocket = (url: string) => new WebSocket(url), fetcher = productFetch, key = process.env.NEXT_PUBLIC_PUBB_APP_KEY) {
  // Polling remains active when an instance has no optional realtime provider.
  if (!key) { options.onState("unavailable"); return () => {}; }
  let disposed = false, attempt = 0, socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, renewal: ReturnType<typeof setTimeout> | undefined;
  let authorization: AbortController | undefined;
  const clear = () => { clearTimeout(deadline); clearTimeout(renewal); authorization?.abort(); };
  function connect() {
    if (disposed) return;
    options.onState(attempt ? "reconnecting" : "connecting");
    const current = createSocket(`wss://ws.pubb.io/socket?appKey=${encodeURIComponent(key!)}&protocol=2`);
    socket = current;
    deadline = setTimeout(() => { options.onState("unavailable"); current.close(); }, 15_000);
    current.onmessage = async ({ data }) => {
      if (disposed || socket !== current || typeof data !== "string" || data.length > 32_000) return;
      try {
        const packet = JSON.parse(data);
        if (packet.event === "pubb:connection_established") {
          const { socket_id } = JSON.parse(packet.data);
          if (typeof socket_id !== "string") return current.close();
          current.send(JSON.stringify({ action: "subscribe", channel: "notifications" }));
          authorization?.abort(); authorization = new AbortController();
          const response = await fetcher(`/api/realtime/auth?organizationId=${encodeURIComponent(options.organizationId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ socket_id, channel_name: options.channel }), signal: authorization.signal });
          if (!response.ok) { options.onState("unavailable"); current.close(); return; }
          const auth = await response.json();
          if (!disposed && socket === current && current.readyState === 1 && typeof auth.auth === "string") current.send(JSON.stringify({ action: "subscribe", channel: options.channel, auth: auth.auth }));
          return;
        }
        if (["subscription_error", "pubb:error", "error"].includes(packet.event)) { reportBrowserError("browser.realtime.subscription", new Error(packet.event)); options.onState("unavailable"); current.close(); return; }
        if (packet.event === "pubb:subscription_succeeded" && packet.channel === options.channel) {
          clearTimeout(deadline); attempt = 0; options.onState("live"); options.onRefresh();
          // Periodic reauthorization also checks changed membership/session.
          renewal = setTimeout(() => current.close(), 5 * 60_000); return;
        }
        if (packet.event || typeof packet.data !== "string") return;
        const event = JSON.parse(packet.data);
        if (packet.channel === options.channel && event.name === "review.changed") options.onRefresh();
        if (packet.channel === options.channel && event.name === "review.activity") options.onActivity?.();
        if (packet.channel === options.channel && event.name === "repository.index") options.onIndex?.();
        if (packet.channel === "notifications" && event.name === "message.sent" && typeof event.data?.message === "string") options.onMessage(event.data.message.slice(0, 200));
      } catch (error) { reportBrowserError("browser.realtime.parse", error); /* Malformed payloads are ignored; an unacknowledged subscription times out. */ }
    };
    current.onerror = () => { if (!disposed) { reportBrowserError("browser.realtime.connection", new Error("Realtime connection failed")); options.onState("unavailable"); } current.close(); };
    current.onclose = () => {
      clear();
      if (disposed || socket !== current) return;
      options.onState("reconnecting");
      const delay = Math.min(1000 * 2 ** Math.min(attempt++, 5), 30_000) + Math.random() * 500;
      retry = setTimeout(connect, delay);
    };
  }
  connect();
  return () => { disposed = true; clear(); clearTimeout(retry); if (socket) { socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); } };
}
