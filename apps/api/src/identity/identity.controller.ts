import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';
import { AuthRequest, IdentityService } from './identity.service';
import { Public } from './session.guard';

class RegisterDto { @IsEmail() email!: string; @MinLength(12) password!: string; }
class LoginDto { @IsEmail() email!: string; @IsString() password!: string; }
class CreateOrganizationDto {
  @IsUUID() parentId!: string;
  @IsIn(['AGENCY','BUSINESS']) type!: 'AGENCY'|'BUSINESS';
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @MinLength(2) slug!: string;
}
class MemberDto { @IsEmail() email!: string; @IsIn(['OWNER','ADMIN','MEMBER']) role!: 'OWNER'|'ADMIN'|'MEMBER'; }
class SwitchDto { @IsUUID() organizationId!: string; }
class SupportDto { @IsString() @MinLength(4) reason!: string; @IsInt() @Min(1) @Max(60) minutes!: number; }

@ApiTags('identity')
@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('auth/register') @Public() register(@Body() body: RegisterDto) { return this.identity.register(body.email,body.password); }
  @Post('auth/login') @Public() async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: { cookie: (name: string, value: string, options: object) => void }) {
    const result = await this.identity.login(body.email,body.password);
    response.cookie('bos_session',result.token,{ httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:7*24*60*60*1000 });
    return result.user;
  }
  @Post('auth/logout') async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: { clearCookie: (name: string, options: object) => void }) {
    const result = await this.identity.logout(request);
    response.clearCookie('bos_session',{ path:'/' });
    return result;
  }
  @Post('auth/refresh') async refresh(@Req() request: AuthRequest, @Res({ passthrough: true }) response: { cookie: (name: string, value: string, options: object) => void }) {
    const result = await this.identity.refresh(request);
    response.cookie('bos_session',result.token,{ httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/',maxAge:7*24*60*60*1000 });
    return result.user;
  }
  @Get('me') me(@Req() request: AuthRequest) { return this.identity.me(request); }
  @Get('organizations') list(@Req() request: AuthRequest) { return this.identity.list(request); }
  @Get('organizations/:id') get(@Req() request: AuthRequest, @Param('id') id: string) { return this.identity.get(request,id); }
  @Post('organizations') create(@Req() request: AuthRequest, @Body() body: CreateOrganizationDto) { return this.identity.create(request,body); }
  @Post('organizations/:id/members') addMember(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: MemberDto) { return this.identity.addMember(request,id,body); }
  @Post('organizations/switch') switch(@Req() request: AuthRequest, @Body() body: SwitchDto) { return this.identity.switchOrganization(request,body.organizationId); }
  @Post('organizations/:id/support-access') support(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: SupportDto) { return this.identity.grantSupport(request,id,body.reason,body.minutes); }
  @Post('support-access/:id/revoke') revoke(@Req() request: AuthRequest, @Param('id') id: string) { return this.identity.revokeSupport(request,id); }
}
