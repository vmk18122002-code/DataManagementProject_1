import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, UseGuards,
  applyDecorators, createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "../types";
import { AuthService, TokenPayload } from "./auth.service";

const ROLES = "roles";
const TEMP_OK = "tempPasswordAllowed";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("sign in required");
    const payload = this.auth.verify(token);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]) ?? [];
    if (roles.length && !roles.includes(payload.role)) throw new ForbiddenException("not allowed for this account");
    if (payload.temp && !this.reflector.get<boolean>(TEMP_OK, ctx.getHandler())) {
      throw new ForbiddenException("choose your own password before using the portal");
    }
    req.user = payload;
    return true;
  }
}

/** Require a valid JWT. With roles, only those roles may call: `@Auth("admin")`, `@Auth("donor")`. */
export const Auth = (...roles: Role[]) => applyDecorators(SetMetadata(ROLES, roles), UseGuards(AuthGuard));

/** Also let in an account that still has its temporary password (only for reading itself and setting a password). */
export const AllowTempPassword = () => SetMetadata(TEMP_OK, true);

/** The token payload ({ sub, role }) of the signed-in caller. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TokenPayload => ctx.switchToHttp().getRequest().user,
);
