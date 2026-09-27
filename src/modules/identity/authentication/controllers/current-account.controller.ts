import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProblemDetailsDto } from '../../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../../common/openapi/problem-response';
import { AccountResponseDto } from '../../account/dto/account.dto';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../guards/session-auth.guard';

/** Exposes the authenticated account representation for the current session. */
@ApiTags('account')
@ApiExtraModels(ProblemDetailsDto)
@Controller('account')
export class CurrentAccountController {
  @Get('me')
  @UseGuards(SessionAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({ summary: 'Get the account for the current session' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  current(@Req() request: Request & AuthenticatedRequest): AccountResponseDto {
    return request.account;
  }
}
