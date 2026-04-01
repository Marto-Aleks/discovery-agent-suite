import Anthropic from "@anthropic-ai/sdk";
import { ProxyAgent } from "undici";

export function createAnthropicClient(apiKey) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;

  return new Anthropic({
    apiKey,
    fetchOptions: proxyUrl
      ? {
          dispatcher: new ProxyAgent(proxyUrl),
        }
      : undefined,
  });
}
