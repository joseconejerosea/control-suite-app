import { Injectable } from '@nestjs/common';
import {
  Counter, Histogram, Gauge, Registry, collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // f1_events_total{client_id, canal, status}
  readonly f1EventsTotal: Counter<string>;

  // f1_ocr_duration_seconds{engine}
  readonly f1OcrDuration: Histogram<string>;

  // f1_ai_duration_seconds{model}
  readonly f1AiDuration: Histogram<string>;

  // f1_ai_tokens_total{client_id, direction}
  readonly f1AiTokens: Counter<string>;

  // f1_confidence_score{client_id}
  readonly f1ConfidenceScore: Histogram<string>;

  // f1_queue_depth{queue_name}
  readonly f1QueueDepth: Gauge<string>;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.f1EventsTotal = new Counter({
      name: 'f1_events_total',
      help: 'Total F1 events by client, canal and status',
      labelNames: ['client_id', 'canal', 'status'],
      registers: [this.registry],
    });

    this.f1OcrDuration = new Histogram({
      name: 'f1_ocr_duration_seconds',
      help: 'OCR processing duration in seconds',
      labelNames: ['engine'],
      buckets: [0.5, 1, 2, 5, 10, 20, 30],
      registers: [this.registry],
    });

    this.f1AiDuration = new Histogram({
      name: 'f1_ai_duration_seconds',
      help: 'AI classification duration in seconds',
      labelNames: ['model'],
      buckets: [0.5, 1, 2, 5, 10, 20],
      registers: [this.registry],
    });

    this.f1AiTokens = new Counter({
      name: 'f1_ai_tokens_total',
      help: 'Total AI tokens used',
      labelNames: ['client_id', 'direction'],
      registers: [this.registry],
    });

    this.f1ConfidenceScore = new Histogram({
      name: 'f1_confidence_score',
      help: 'AI classification confidence scores',
      labelNames: ['client_id'],
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      registers: [this.registry],
    });

    this.f1QueueDepth = new Gauge({
      name: 'f1_queue_depth',
      help: 'Current queue depth by queue name',
      labelNames: ['queue_name'],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}