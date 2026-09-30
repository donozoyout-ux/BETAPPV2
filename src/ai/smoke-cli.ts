import { NvidiaProvider } from './nvidia-provider.js';

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const baseUrl = process.env.NVIDIA_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1';
  const model = process.env.NVIDIA_MODEL?.trim() || 'deepseek-ai/deepseek-v4.1-flash';

  if (!apiKey) {
    console.log('NVIDIA_AI_SMOKE | NOT_CONFIGURED');
    console.log(JSON.stringify({
      status: 'NOT_CONFIGURED',
      configured: false,
      model,
      baseUrl,
      reachable: null,
    }));
    return;
  }

  const provider = new NvidiaProvider({
    apiKey,
    baseUrl,
    model,
    timeoutMs: 15_000,
  });

  const result = await provider.checkAvailability();

  if (result.reachable) {
    console.log('NVIDIA_AI_SMOKE | CONNECTED');
    console.log(JSON.stringify({
      status: 'CONNECTED',
      configured: true,
      reachable: true,
      latencyMs: result.latencyMs,
      model: result.model,
    }));
  } else {
    const code = result.errorCode || 'API_ERROR';
    if (code === 'AUTH_ERROR') {
      console.log('NVIDIA_AI_SMOKE | AUTH_ERROR');
    } else if (code === 'RATE_LIMIT') {
      console.log('NVIDIA_AI_SMOKE | RATE_LIMIT');
    } else if (code === 'TIMEOUT') {
      console.log('NVIDIA_AI_SMOKE | TIMEOUT');
    } else {
      console.log('NVIDIA_AI_SMOKE | API_ERROR');
    }
    console.log(JSON.stringify({
      status: code,
      configured: true,
      reachable: false,
      latencyMs: result.latencyMs,
      model: result.model,
      errorCode: code,
    }));
  }
}

main().catch((err) => {
  const isAbort = (err as { name?: string })?.name === 'AbortError';
  const code = isAbort ? 'TIMEOUT' : 'API_ERROR';
  console.log(`NVIDIA_AI_SMOKE | ${code}`);
  console.log(JSON.stringify({
    status: code,
    configured: true,
    reachable: false,
    errorCode: code,
  }));
});
