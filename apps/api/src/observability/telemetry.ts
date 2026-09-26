import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/,'');
  sdk = new NodeSDK({
    serviceName: 'business-os-api',
    traceExporter: new OTLPTraceExporter({ url:`${base}/v1/traces` }),
    metricReaders: [new PeriodicExportingMetricReader({ exporter:new OTLPMetricExporter({ url:`${base}/v1/metrics` }), exportIntervalMillis:15000 })],
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> { await sdk?.shutdown(); sdk = undefined; }
