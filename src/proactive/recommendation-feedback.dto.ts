import { IsIn, IsOptional, IsString } from 'class-validator';

export class RecommendationFeedbackDto {
  @IsIn(['approved', 'rejected', 'ignored'])
  outcome!: 'approved' | 'rejected' | 'ignored';

  @IsOptional()
  @IsString()
  reason?: string;
}
