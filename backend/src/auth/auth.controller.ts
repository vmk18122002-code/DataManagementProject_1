import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AllowTempPassword, Auth, CurrentUser } from "./auth.guard";
import { AuthService, TokenPayload } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("donor/register")
  registerDonor(@Body() body: Record<string, unknown>) {
    return this.auth.registerDonor(body ?? {});
  }

  @Post("donor/login")
  @HttpCode(200)
  loginDonor(@Body() body: Record<string, unknown>) {
    return this.auth.loginDonor(body ?? {});
  }

  @Post("org/login")
  @HttpCode(200)
  loginOrg(@Body() body: Record<string, unknown>) {
    return this.auth.loginOrg(body ?? {});
  }

  /** { email } - emails a temporary password if the donor account exists. Always answers { ok: true }. */
  @Post("donor/forgot")
  @HttpCode(200)
  forgotDonor(@Body() body: Record<string, unknown>) {
    return this.auth.forgotPassword("donor", body ?? {});
  }

  /** { email } - the same for organization members and collectors. */
  @Post("org/forgot")
  @HttpCode(200)
  forgotOrg(@Body() body: Record<string, unknown>) {
    return this.auth.forgotPassword("org", body ?? {});
  }

  /** An organization admin adds another member: { name, email, password, role: "admin" | "collector", org?, district? } */
  @Post("org/users")
  @Auth("admin")
  createOrgUser(@Body() body: Record<string, unknown>) {
    return this.auth.createOrgUser(body ?? {});
  }

  /** { newPassword, currentPassword? } - currentPassword is not needed while the account has its temporary password. */
  @Post("password")
  @HttpCode(200)
  @Auth()
  @AllowTempPassword()
  changePassword(@CurrentUser() user: TokenPayload, @Body() body: Record<string, unknown>) {
    return this.auth.changePassword(user, body ?? {});
  }

  @Get("me")
  @Auth()
  @AllowTempPassword()
  me(@CurrentUser() user: TokenPayload) {
    return this.auth.me(user);
  }
}
