import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IntentModule } from './intent/intent.module';

@Module({
  imports: [IntentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
