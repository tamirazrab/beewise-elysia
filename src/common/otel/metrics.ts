import { metrics } from '@opentelemetry/api';
import { env } from '@common/config/env';

const METER_NAME = 'beewise-api';
const ENV = env.APP_ENV;

let meter: ReturnType<typeof metrics.getMeter> | null = null;

function getMeter() {
  if (!meter) meter = metrics.getMeter(METER_NAME, env.OTEL_SERVICE_VERSION);
  return meter;
}

let httpDuration: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;
let httpCount: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let httpErrorCount: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let externalDuration: ReturnType<ReturnType<typeof metrics.getMeter>['createHistogram']> | null = null;
let externalFailure: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let bundleAttempt: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let bundleSuccess: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let bundleFailure: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let paymentSuccess: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;
let paymentFailure: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null;

function getInstruments() {
  const m = getMeter();
  if (!httpDuration) {
    httpDuration = m.createHistogram('http.server.request.duration', { unit: 's', description: 'HTTP request duration' });
    httpCount = m.createCounter('http.server.request.count', { description: 'HTTP request count' });
    httpErrorCount = m.createCounter('http.server.error.count', { description: 'HTTP error count' });
    externalDuration = m.createHistogram('external.api.duration', { unit: 's', description: 'External API latency' });
    externalFailure = m.createCounter('external.api.failure.count', { description: 'External API failure count' });
    bundleAttempt = m.createCounter('bundle_purchase_attempt', { description: 'Bundle purchase attempt' });
    bundleSuccess = m.createCounter('bundle_purchase_success', { description: 'Bundle purchase success' });
    bundleFailure = m.createCounter('bundle_purchase_failure', { description: 'Bundle purchase failure' });
    paymentSuccess = m.createCounter('payment_success', { description: 'Payment success' });
    paymentFailure = m.createCounter('payment_failure', { description: 'Payment failure' });
  }
  return { httpDuration: httpDuration!, httpCount: httpCount!, httpErrorCount: httpErrorCount!, externalDuration: externalDuration!, externalFailure: externalFailure!, bundleAttempt: bundleAttempt!, bundleSuccess: bundleSuccess!, bundleFailure: bundleFailure!, paymentSuccess: paymentSuccess!, paymentFailure: paymentFailure! };
}

export function recordHttpRequest(durationMs: number, route: string, statusCode: number) {
  try {
    const { httpDuration: h, httpCount: c } = getInstruments();
    const durationSec = durationMs / 1000;
    h.record(durationSec, { environment: ENV, 'http.route': route, 'http.status_code': statusCode });
    c.add(1, { environment: ENV, 'http.route': route, 'http.status_code': statusCode });
  } catch {
    // No-op if MeterProvider not yet set
  }
}

export function recordHttpError(route: string, statusCode: number) {
  try {
    getInstruments().httpErrorCount.add(1, { environment: ENV, 'http.route': route, status_code: statusCode });
  } catch {
    // No-op
  }
}

export function recordExternalCall(provider: string, durationMs: number, success: boolean) {
  try {
    const { externalDuration: h, externalFailure: f } = getInstruments();
    h.record(durationMs / 1000, { provider, environment: ENV });
    if (!success) f.add(1, { provider, environment: ENV });
  } catch {
    // No-op
  }
}

export function recordBundlePurchaseAttempt() {
  try {
    getInstruments().bundleAttempt.add(1, { environment: ENV });
  } catch {
    // No-op
  }
}

export function recordBundlePurchaseSuccess() {
  try {
    getInstruments().bundleSuccess.add(1, { environment: ENV });
  } catch {
    // No-op
  }
}

export function recordBundlePurchaseFailure() {
  try {
    getInstruments().bundleFailure.add(1, { environment: ENV });
  } catch {
    // No-op
  }
}

export function recordPaymentSuccess(provider?: string) {
  try {
    getInstruments().paymentSuccess.add(1, provider ? { environment: ENV, provider } : { environment: ENV });
  } catch {
    // No-op
  }
}

export function recordPaymentFailure(provider?: string) {
  try {
    getInstruments().paymentFailure.add(1, provider ? { environment: ENV, provider } : { environment: ENV });
  } catch {
    // No-op
  }
}
