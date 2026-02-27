import { env } from '@common/config/env';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';

const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
const metricsEndpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
const enableOtel =
  (env.APP_ENV === 'staging' || env.APP_ENV === 'production') &&
  (tracesEndpoint.length > 0 || metricsEndpoint.length > 0);

const resource = resourceFromAttributes({
  'service.name': env.OTEL_SERVICE_NAME,
  'service.version': env.OTEL_SERVICE_VERSION,
  'deployment.environment': env.APP_ENV,
});

const pluginOptions: Record<string, unknown> = {
  resource,
  serviceName: env.OTEL_SERVICE_NAME,
  autoDetectResources: false,
};

if (enableOtel && tracesEndpoint.length > 0) {
  pluginOptions.traceExporter = new OTLPTraceExporter({ url: tracesEndpoint });
}

if (enableOtel && metricsEndpoint.length > 0) {
  pluginOptions.metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: metricsEndpoint }),
    exportIntervalMillis: 15_000,
  });
}

export { pluginOptions as opentelemetryPluginOptions, enableOtel };
