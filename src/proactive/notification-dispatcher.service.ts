import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';

export interface DispatchNotificationInput {
  recommendationId: string;
  walletPubkey: string;
  title: string;
  body: string;
  confidence: number;
  shouldNotify: boolean;
  threadId?: string;
}

export interface DispatchNotificationResult {
  dispatched: boolean;
  deliveryId?: string;
  status?: 'queued' | 'sent' | 'failed';
  providerMessageId?: string;
  reason?: 'suppressed';
  error?: string;
}

@Injectable()
export class NotificationDispatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async dispatch(input: DispatchNotificationInput): Promise<DispatchNotificationResult> {
    const recommendationId = input.recommendationId.trim();
    const walletPubkey = input.walletPubkey.trim();
    const title = input.title.trim();
    const body = input.body.trim();

    if (!recommendationId || !walletPubkey || !title || !body) {
      throw new BadRequestException('recommendationId, walletPubkey, title, and body are required');
    }

    const threshold = this.resolveThreshold();
    if (!input.shouldNotify || !Number.isFinite(input.confidence) || input.confidence < threshold) {
      return {
        dispatched: false,
        reason: 'suppressed',
      };
    }

    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        recommendationId,
        channel: 'push',
        status: 'queued',
      },
    });

    try {
      const { appId, restApiKey } = this.readOneSignalConfig();
      const response = await fetch(ONESIGNAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${restApiKey}`,
        },
        body: JSON.stringify({
          app_id: appId,
          include_external_user_ids: [walletPubkey],
          headings: { en: title },
          contents: { en: body },
          data: {
            recommendationId,
            ...(input.threadId ? { threadId: input.threadId } : {}),
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`OneSignal request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { id?: unknown };
      const providerMessageId = typeof payload.id === 'string' ? payload.id : undefined;
      if (!providerMessageId) {
        throw new Error('OneSignal response missing notification id');
      }

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'sent',
          providerMessageId,
          sentAt: new Date(),
        },
      });

      return {
        dispatched: true,
        deliveryId: delivery.id,
        status: 'sent',
        providerMessageId,
      };
    } catch (error) {
      const message = this.toErrorMessage(error);

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          error: message,
        },
      });

      return {
        dispatched: true,
        deliveryId: delivery.id,
        status: 'failed',
        error: message,
      };
    }
  }

  private readOneSignalConfig(): { appId: string; restApiKey: string } {
    const appId = process.env.ONESIGNAL_APP_ID?.trim();
    const restApiKey = process.env.ONESIGNAL_REST_API_KEY?.trim();

    if (!appId || !restApiKey) {
      throw new Error('ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY are required');
    }

    return { appId, restApiKey };
  }

  private resolveThreshold(): number {
    const configured = Number(process.env.PROACTIVE_NOTIFICATION_CONFIDENCE_THRESHOLD);
    if (!Number.isFinite(configured)) {
      return DEFAULT_CONFIDENCE_THRESHOLD;
    }

    return Math.min(1, Math.max(0, configured));
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'unknown_dispatch_error';
  }
}
