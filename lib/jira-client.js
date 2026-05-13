import { ProxyAgent } from "undici";

function getProxyDispatcher() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

function getBaseUrl() {
  const instance = process.env.TR_INSTANCE || "tracker19";
  return `https://rb-tracker.bosch.com/${instance}/rest/api/2`;
}

function getBrowseUrl(key) {
  const instance = process.env.TR_INSTANCE || "tracker19";
  return `https://rb-tracker.bosch.com/${instance}/browse/${key}`;
}

function getHeaders() {
  const pat = process.env.TR_PAT;
  if (!pat) throw new Error("TR_PAT is not set");

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${pat}`,
  };

  const apiKey = process.env.TR_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;

  return headers;
}

export async function createStory({ title, description, projectKey, jiraPriority }) {
  const fields = {
    project: { key: projectKey },
    summary: title,
    description,
    issuetype: { name: "User Story" },
  };

  if (jiraPriority) fields.priority = { name: jiraPriority };

  const res = await fetch(`${getBaseUrl()}/issue`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ fields }),
    dispatcher: getProxyDispatcher(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira ${res.status}: ${body}`);
  }

  const data = await res.json();
  return {
    key: data.key,
    url: getBrowseUrl(data.key),
  };
}
