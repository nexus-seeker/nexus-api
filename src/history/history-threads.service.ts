import { Injectable } from '@nestjs/common';
import type { ConversationThreadDto } from '../contracts/mvp';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HistoryThreadsService {
  constructor(private readonly prisma: PrismaService) { }

  async listThreads(pubkey: string): Promise<ConversationThreadDto[]> {
    const threads = await this.prisma.conversationThread.findMany({
      where: { walletPubkey: pubkey },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        messages: {
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    return threads.map((thread) => {
      let title = thread.title;
      if (!title && thread.messages && thread.messages.length > 0) {
        title = thread.messages[0].content;
        if (title.length > 40) {
          title = title.substring(0, 40) + '...';
        }
      }

      return {
        id: thread.id,
        pubkey: thread.walletPubkey,
        title: title || 'New Conversation',
        createdAt: thread.createdAt.getTime(),
        updatedAt: thread.updatedAt.getTime(),
      };
    });
  }
}
