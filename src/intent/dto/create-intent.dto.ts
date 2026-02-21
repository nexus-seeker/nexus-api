import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateIntentDto {
    @ApiProperty({ description: 'The unique ID of the user' })
    @IsString()
    @IsNotEmpty()
    user_id: string;

    @ApiProperty({ description: 'The natural language intent to execute' })
    @IsString()
    @IsNotEmpty()
    intent: string;

    @ApiProperty({ description: 'The public key of the user for Solana transactions' })
    @IsString()
    @IsNotEmpty()
    user_public_key: string;
}
