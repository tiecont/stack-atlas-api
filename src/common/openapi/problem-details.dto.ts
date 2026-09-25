import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProblemDetailsDto {
  @ApiProperty({ example: 'about:blank' })
  type!: string;

  @ApiProperty({ example: 'Bad Request' })
  title!: string;

  @ApiProperty({ minimum: 100, maximum: 599, example: 400 })
  status!: number;

  @ApiPropertyOptional({ example: 'The request could not be processed.' })
  detail?: string;

  @ApiProperty({ example: '/api/v1/resource' })
  instance!: string;
}
