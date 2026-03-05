import { Module } from '@nestjs/common';
import { RaydiumService } from './raydium.service';
import { RouteSelectorService } from './route-selector.service';
import { MarinadeService } from './marinade.service';

@Module({
  providers: [RaydiumService, RouteSelectorService, MarinadeService],
  exports: [RaydiumService, RouteSelectorService, MarinadeService],
})
export class ProtocolsModule {}
