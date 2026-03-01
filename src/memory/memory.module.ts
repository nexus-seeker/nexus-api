import { Module } from '@nestjs/common';
import { UserMemoryService } from './user-memory.service';
import { DatabaseModule } from '../database/database.module';
import { SemanticMemoryService } from './semantic-memory.service';

@Module({
    imports: [DatabaseModule],
    providers: [UserMemoryService, SemanticMemoryService],
    exports: [UserMemoryService, SemanticMemoryService],
})
export class MemoryModule { }
