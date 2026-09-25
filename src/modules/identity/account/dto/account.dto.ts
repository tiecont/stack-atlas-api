import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength, MinLength } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ maxLength: 254, example: 'reader@example.test' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
