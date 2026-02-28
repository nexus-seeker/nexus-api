import { Module } from '@nestjs/common';
import { RaydiumService } from './raydium.service';
import { RouteSelectorService } from './route-selector.service';

@Module({
  providers: [RaydiumService, RouteSelectorService],
  exports: [RaydiumService, RouteSelectorService],
})
export class ProtocolsModule {}
