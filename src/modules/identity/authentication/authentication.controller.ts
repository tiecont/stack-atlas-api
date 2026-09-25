import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ProblemDetailsDto } from '../../../common/openapi/problem-details.dto';
import { problemDetailsResponse } from '../../../common/openapi/problem-response';
import type { AuthenticatedRequest } from './session-auth.guard';
import { AuthenticationService } from './authentication.service';
import { LoginDto } from './authentication.dto';
import { OriginGuard } from './origin.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { AccountResponseDto } from '../account/account.dto';

@ApiTags('authentication')
@ApiExtraModels(ProblemDetailsDto)
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post('login')
  @UseGuards(OriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a session with an account and password' })
  @ApiOkResponse({ type: AccountResponseDto })
  @ApiResponse(problemDetailsResponse(400, 'Invalid login data'))
  @ApiResponse(problemDetailsResponse(401, 'Email or password is incorrect'))
  @ApiResponse(problemDetailsResponse(403, 'Origin is not allowed'))
  login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccountResponseDto> {
    return this.authentication.login(input, response);
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard, OriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('stack_atlas_session')
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiNoContentResponse()
  @ApiResponse(problemDetailsResponse(401, 'A valid session is required'))
  @ApiResponse(problemDetailsResponse(403, 'Origin is not allowed'))
  async logout(
    @Req() request: Request & AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authentication.logout(request.sessionId, request.account.id);
    this.authentication.clearCookie(response);
  }
}
