import {
  IsDefined,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class IngestProactiveEventDto {
  @IsString()
  @IsNotEmpty()
  wallet!: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsString()
  @IsNotEmpty()
  sourceEventId!: string;

  @IsString()
  @IsNotEmpty()
  kind!: string;

  @IsOptional()
  @IsISO8601()
  eventAt?: string;

  @IsDefined()
  payload!: unknown;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  threadId?: string;
}
