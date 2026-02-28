import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('connects and disconnects via Nest lifecycle hooks', async () => {
    const service = new PrismaService();
    service.$connect = jest.fn().mockResolvedValue(undefined) as any;
    service.$disconnect = jest.fn().mockResolvedValue(undefined) as any;

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(service.$connect).toHaveBeenCalledTimes(1);
    expect(service.$disconnect).toHaveBeenCalledTimes(1);
  });
});
