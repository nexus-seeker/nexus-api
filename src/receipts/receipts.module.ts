import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptReconcilerService } from './receipt-reconciler.service';
import { ReceiptsService } from './receipts.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptReconcilerService],
  exports: [ReceiptsService, ReceiptReconcilerService],
})
export class ReceiptsModule {}
