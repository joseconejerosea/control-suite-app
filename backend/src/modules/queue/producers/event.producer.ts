import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import {
  JOB_NOTIFY_ADMIN,
  JOB_PROCESS_EVENT,
  QUEUE_ADMIN_NOTIFICATIONS,
  QUEUE_EVENT_PROCESSING,
} from '../queue.constants';

@Injectable()
export class EventProducer {
  constructor(
    @InjectQueue(QUEUE_EVENT_PROCESSING)
    private readonly eventQueue: Queue,

    @InjectQueue(QUEUE_ADMIN_NOTIFICATIONS)
    private readonly notifQueue: Queue,
  ) {}

  async publishProcessEvent(eventoCrudoId: string): Promise<Job> {
    return this.eventQueue.add(
      JOB_PROCESS_EVENT,
      { eventoCrudoId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 }, // keep last 1000 completed for debugging
        removeOnFail: { count: 5000 },     // keep last 5000 failed for investigation
      },
    );
  }

  async publishAdminNotification(eventoCrudoId: string, reason: string): Promise<Job> {
    return this.notifQueue.add(
      JOB_NOTIFY_ADMIN,
      { eventoCrudoId, reason },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      },
    );
  }
}
