import { Module } from '@nestjs/common';
import { UserMemoryService } from './user-memory.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    providers: [UserMemoryService],
    exports: [UserMemoryService],
})
export class MemoryModule { }
