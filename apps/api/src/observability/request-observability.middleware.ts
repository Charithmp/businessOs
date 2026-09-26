import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { context, metrics, propagation, SpanStatusCode, trace } from '@opentelemetry/api';
import { AuthRequest } from '../identity/identity.service';
import { ObservabilityService } from './observability.service';

type Request = AuthRequest & { baseUrl?:string; route?:{ path?:string } };
type Response = { statusCode:number; setHeader:(name:string,value:string)=>void; on:(event:string,handler:()=>void)=>void };

const tracer = trace.getTracer('business-os-api');

@Injectable()
export class RequestObservabilityMiddleware implements NestMiddleware {
  private readonly meter = metrics.getMeter('business-os-api');
  private readonly requestCount = this.meter.createCounter('business_os_http_requests',{ description:'Completed API requests' });
  private readonly requestDuration = this.meter.createHistogram('business_os_http_duration_ms',{ description:'API request duration in milliseconds',unit:'ms' });
  constructor(private readonly observability:ObservabilityService) {}

  use(request:Request,response:Response,next:()=>void) {
    const requestId = randomUUID();
    response.setHeader('x-request-id',requestId);
    const parent = request.headers.traceparent ? propagation.extract(context.active(),{ traceparent:request.headers.traceparent }) : context.active();
    const span = tracer.startSpan('HTTP request',{},parent);
    const started = process.hrtime.bigint();
    response.on('finish',()=>{
      const durationMs = Math.max(0,Math.round(Number(process.hrtime.bigint()-started)/1_000_000));
      // Express exposes the matched route after routing. Never store raw URLs, query strings, bodies or headers.
      const route = request.route?.path ? `${request.baseUrl ?? ''}${request.route.path}` : 'unmatched';
      const statusCode = response.statusCode;
      span.updateName(`${request.method} ${route}`);
      span.setAttributes({ 'http.request.method':request.method,'http.route':route,'http.response.status_code':statusCode });
      if (statusCode >= 500) span.setStatus({ code:SpanStatusCode.ERROR });
      const traceId = span.spanContext().traceId;
      span.end();
      this.requestCount.add(1,{ route,method:request.method,status_code:statusCode });
      this.requestDuration.record(durationMs,{ route,method:request.method,status_code:statusCode });
      void this.observability.recordRequest({ requestId,traceId,
        organizationId:request.user?.organizationId ?? null,actorUserId:request.user?.id ?? null,
        method:request.method,route,statusCode,durationMs }).catch(()=>{
          // Logging must not expose a failed request payload or interrupt a completed response.
          process.stderr.write('Observability write failed\n');
        });
    });
    next();
  }
}
