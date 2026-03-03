import { PrismaService } from '../database/prisma.service';
import { NotificationDispatcherService } from './notification-dispatcher.service';

describe('NotificationDispatcherService', () => {
  const originalAppId = process.env.ONESIGNAL_APP_ID;
  const originalApiKey = process.env.ONESIGNAL_REST_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalAppId === undefined) {
      delete process.env.ONESIGNAL_APP_ID;
    } else {
      process.env.ONESIGNAL_APP_ID = originalAppId;
    }

    if (originalApiKey === undefined) {
      delete process.env.ONESIGNAL_REST_API_KEY;
    } else {
      process.env.ONESIGNAL_REST_API_KEY = originalApiKey;
    }

    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts eligible recommendation to OneSignal and records delivery', async () => {
    process.env.ONESIGNAL_APP_ID = 'app-id-1';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-key-1';

    const create = jest.fn().mockResolvedValue({ id: 'delivery-1' });
    const update = jest.fn().mockResolvedValue({ id: 'delivery-1' });

    const prisma = {
      notificationDelivery: {
        create,
        update,
      },
    } as unknown as PrismaService;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'onesignal-1' }),
    } as Response);

    const service = new NotificationDispatcherService(prisma);

    await service.dispatch({
      recommendationId: 'rec-1',
      walletPubkey: 'wallet-1',
      title: 'SOL moved',
      body: 'Review now',
      shouldNotify: true,
      confidence: 0.82,
      threadId: 'thread-1',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('onesignal.com');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: 'Basic rest-key-1',
      }),
    );

    const parsedBody = JSON.parse(String(request.body));
    expect(parsedBody).toEqual(
      expect.objectContaining({
        app_id: 'app-id-1',
        include_external_user_ids: ['wallet-1'],
        headings: { en: 'SOL moved' },
        contents: { en: 'Review now' },
      }),
    );
    expect(parsedBody.data).toEqual(
      expect.objectContaining({
        recommendationId: 'rec-1',
        threadId: 'thread-1',
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        recommendationId: 'rec-1',
        channel: 'push',
        status: 'queued',
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: 'sent',
        providerMessageId: 'onesignal-1',
      }),
    });
  });

  it('suppresses dispatch when confidence is below threshold', async () => {
    process.env.ONESIGNAL_APP_ID = 'app-id-1';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-key-1';

    const create = jest.fn();
    const update = jest.fn();

    const prisma = {
      notificationDelivery: {
        create,
        update,
      },
    } as unknown as PrismaService;

    global.fetch = jest.fn();

    const service = new NotificationDispatcherService(prisma);

    const result = await service.dispatch({
      recommendationId: 'rec-1',
      walletPubkey: 'wallet-1',
      title: 'SOL moved',
      body: 'Review now',
      shouldNotify: true,
      confidence: 0.2,
    });

    expect(result).toEqual({ dispatched: false, reason: 'suppressed' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('suppresses dispatch when confidence is NaN', async () => {
    process.env.ONESIGNAL_APP_ID = 'app-id-1';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-key-1';

    const create = jest.fn();
    const update = jest.fn();

    const prisma = {
      notificationDelivery: {
        create,
        update,
      },
    } as unknown as PrismaService;

    global.fetch = jest.fn();

    const service = new NotificationDispatcherService(prisma);

    const result = await service.dispatch({
      recommendationId: 'rec-1',
      walletPubkey: 'wallet-1',
      title: 'SOL moved',
      body: 'Review now',
      shouldNotify: true,
      confidence: Number.NaN,
    });

    expect(result).toEqual({ dispatched: false, reason: 'suppressed' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('marks delivery failed when OneSignal response has no id', async () => {
    process.env.ONESIGNAL_APP_ID = 'app-id-1';
    process.env.ONESIGNAL_REST_API_KEY = 'rest-key-1';

    const create = jest.fn().mockResolvedValue({ id: 'delivery-1' });
    const update = jest.fn().mockResolvedValue({ id: 'delivery-1' });

    const prisma = {
      notificationDelivery: {
        create,
        update,
      },
    } as unknown as PrismaService;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const service = new NotificationDispatcherService(prisma);

    const result = await service.dispatch({
      recommendationId: 'rec-1',
      walletPubkey: 'wallet-1',
      title: 'SOL moved',
      body: 'Review now',
      shouldNotify: true,
      confidence: 0.82,
    });

    expect(result.status).toBe('failed');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({
        status: 'failed',
        error: 'OneSignal response missing notification id',
      }),
    });
  });
});
