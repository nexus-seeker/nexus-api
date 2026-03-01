import { Injectable } from '@nestjs/common';
import type { ConversationThreadDto } from '../contracts/mvp';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HistoryThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async listThreads(pubkey: string): Promise<ConversationThreadDto[]> {
    const threads = await this.prisma.conversationThread.findMany({
      where: { walletPubkey: pubkey },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return threads.map((thread) => ({
      id: thread.id,
      pubkey: thread.walletPubkey,
      ...(thread.title ? { title: thread.title } : {}),
      createdAt: thread.createdAt.getTime(),
      updatedAt: thread.updatedAt.getTime(),
    }));
  }
}
