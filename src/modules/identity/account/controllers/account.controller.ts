import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProblemDetailsDto } from '../../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../../common/openapi/problem-response';
import { OriginGuard } from '../../../../common/http/security/origin.guard';
import { AccountResponseDto, CreateAccountDto } from '../dto/account.dto';
import { AccountService } from '../services/account.service';

@ApiTags('account')
@ApiExtraModels(ProblemDetailsDto)
@Controller('account')
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Post()
  @UseGuards(OriginGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create an account' })
  @ApiCreatedResponse({ type: AccountResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid account data'))
  @ApiResponse(problemDetailsResponse(403, 'Origin is not allowed'))
  @ApiResponse(problemDetailsResponse(409, 'Email is already registered'))
  create(@Body() input: CreateAccountDto): Promise<AccountResponseDto> {
    return this.accounts.create(input);
  }
}
