// Public client transport only. Credentials remain in the server process.
export const inkspectProviderEndpoint = "https://app.inkspect.si/api/provider";
export function modelTransport(env: Record<string,string|undefined> = process.env) {
  const provider=env.INKSPECT_AI_PROVIDER || "bedrock";
  if (!["bedrock","inkspect"].includes(provider)) throw new Error("Choose bedrock or inkspect as the AI provider.");
  if(provider==="bedrock")return {provider,key:env.AWS_BEARER_TOKEN_BEDROCK?.trim(),endpoint:undefined};
  const key=env.INKSPECT_API_KEY?.trim();
  if(!key || !/^isk_live_[a-f0-9]{64}$/.test(key))throw new Error("Set a valid Inkspect API key on this instance.");
  return {provider,key,endpoint:inkspectProviderEndpoint};
}
export function engineModelEnvironment(env: Record<string,string|undefined> = process.env): Record<string,string> {
  const transport=modelTransport(env);
  if(transport.provider!=="inkspect")return {};
  return {AWS_ENDPOINT_URL_BEDROCK_RUNTIME:transport.endpoint!,AWS_BEARER_TOKEN_BEDROCK:transport.key!,AWS_EC2_METADATA_DISABLED:"true"};
}
