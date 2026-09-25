import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ maxLength: 254, example: 'reader@example.test' })
  @IsEmail({ allow_utf8_local_part: false })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
