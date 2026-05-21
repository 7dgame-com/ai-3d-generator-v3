import http from 'node:http';
import https from 'node:https';
import type { AxiosRequestConfig } from 'axios';

export const PROVIDER_PROXY_TIMEOUT_MS = 30000;

const providerHttpAgent = new http.Agent({ family: 4 });
const providerHttpsAgent = new https.Agent({ family: 4 });

export function createProviderStreamRequestConfig(): AxiosRequestConfig {
  return {
    responseType: 'stream',
    timeout: PROVIDER_PROXY_TIMEOUT_MS,
    httpAgent: providerHttpAgent,
    httpsAgent: providerHttpsAgent,
    proxy: false,
  };
}
