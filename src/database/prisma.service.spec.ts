import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

class TestPrismaService extends PrismaService {
  connectCalls = 0;
  disconnectCalls = 0;

  async $connect(): Promise<void> {
    this.connectCalls += 1;
  }

  async $disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }
}

@Module({
  providers: [TestPrismaService],
})
class TestDatabaseModule {}

describe('PrismaService', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('connects and disconnects via Nest lifecycle hooks', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.NODE_ENV = 'test';

    const service = new PrismaService();
    service.$connect = jest.fn().mockResolvedValue(undefined) as any;
    service.$disconnect = jest.fn().mockResolvedValue(undefined) as any;

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(service.$connect).toHaveBeenCalledTimes(1);
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('skips connection when DATABASE_URL is missing in test environment', async () => {
    process.env.DATABASE_URL = '';
    process.env.NODE_ENV = 'test';

    const service = new PrismaService();
    service.$connect = jest.fn().mockResolvedValue(undefined) as any;

    await service.onModuleInit();

    expect(service.$connect).not.toHaveBeenCalled();
  });

  it('integrates with Nest application lifecycle', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

    const moduleRef = await Test.createTestingModule({
      imports: [TestDatabaseModule],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(TestPrismaService);
    expect(service.connectCalls).toBe(1);

    await moduleRef.close();

    expect(service.disconnectCalls).toBe(1);
  });
});
