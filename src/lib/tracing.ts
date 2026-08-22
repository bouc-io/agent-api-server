/**
 * OpenTelemetry bootstrap — traces AND metrics over OTLP.
 *
 * Emits OTLP to the bouc.io OTel collector (`boucio-otel-collector`, OTLP http :4318),
 * which routes traces → Jaeger and metrics → Prometheus (`:8889`, where they appear
 * `otel_`-prefixed and `environment`-tagged). Auto-instruments HTTP + Express.
 *
 * This is the OTLP path; it is ADDITIVE to the prom-client `/metrics` endpoint
 * (lib/promMetrics.ts), which stays as the direct-scrape source of the `agent_*`
 * business metrics. Both are intended (see OBSERVABILITY_DESIGN.md).
 *
 * IMPORTANT: this module must be imported FIRST in the process entrypoint
 * (index.ts) so the instrumentations can patch `require()` before express/http
 * are loaded.
 *
 * No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set (or OTEL_ENABLED=true), so local
 * dev without a collector runs untouched and never spams connection errors.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const enabled = process.env.OTEL_ENABLED === 'true' || !!endpoint;
const METRIC_EXPORT_INTERVAL_MS = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || '60000', 10);

let sdk: NodeSDK | null = null;

if (enabled) {
  // NodeSDK reads OTEL_SERVICE_NAME from the environment for the resource.
  // Default to the package name so this file is identical across services.
  if (!process.env.OTEL_SERVICE_NAME) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    process.env.OTEL_SERVICE_NAME = (require('../../package.json') as { name: string }).name;
  }

  sdk = new NodeSDK({
    // OTLPTraceExporter appends /v1/traces; pass the collector base URL via env.
    traceExporter: new OTLPTraceExporter(
      endpoint ? { url: `${endpoint.replace(/\/$/, '')}/v1/traces` } : {}
    ),
    // OTLP metrics → collector → Prometheus (otel_-prefixed). Additive to /metrics.
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(
        endpoint ? { url: `${endpoint.replace(/\/$/, '')}/v1/metrics` } : {}
      ),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is extremely noisy and rarely useful here.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    // eslint-disable-next-line no-console
    console.log(`[tracing] OpenTelemetry started (endpoint=${endpoint ?? 'default'})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tracing] OpenTelemetry init failed', err);
  }

  const shutdown = () => {
    sdk?.shutdown().catch(() => undefined);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export { sdk };
