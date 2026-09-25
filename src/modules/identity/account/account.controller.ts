import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProblemDetailsDto } from '../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../common/openapi/problem-response';
import { OriginGuard } from '../authentication/origin.guard';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../authentication/session-auth.guard';
import { AccountResponseDto, CreateAccountDto } from './account.dto';
import { AccountService } from './account.service';

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

  @Get('me')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('stack_atlas_session')
  @ApiOperation({ summary: 'Get the account for the current session' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  current(@Req() request: Request & AuthenticatedRequest): AccountResponseDto {
    return request.account;
  }
}
