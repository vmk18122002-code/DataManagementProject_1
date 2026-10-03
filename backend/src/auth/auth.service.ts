import {
  BadRequestException, ConflictException, Injectable, Logger, OnModuleInit, UnauthorizedException,
} from "@nestjs/common";
import { compare, hash, hashSync } from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
import { SignOptions, sign, verify } from "jsonwebtoken";
import { Collection, ObjectId } from "mongodb";
import { MailService } from "../mail.service";
import { DonorDoc, MongoService, OrgUserDoc } from "../mongo.service";
import { AuthUser, OrgRole, Role } from "../types";

export interface TokenPayload {
  sub: string;
  role: Role;
  /** signed in with a temporary password: such a token can only read /auth/me and set a password */
  temp?: true;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORG_ROLES: OrgRole[] = ["admin", "collector"];
const TEMP_HOURS = Number(process.env.TEMP_PASSWORD_HOURS) || 48; // how long a temporary password works
export type AccountKind = "donor" | "org";
// compared against when the email is unknown, so a wrong email takes as long as a wrong password
const DUMMY_HASH = hashSync("no such account", 12);

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function donorUser(d: DonorDoc): AuthUser {
  return { id: d._id.toHexString(), role: "donor", name: d.name, email: d.email, phone: d.phone, address: d.address, district: d.district };
}
function orgUser(u: OrgUserDoc): AuthUser {
  return {
    id: u._id.toHexString(), role: u.role, name: u.name, email: u.email, org: u.org, district: u.district,
    phone: u.phone, vehicleType: u.vehicleType, vehicleNo: u.vehicleNo, dropoff: u.dropoff,
  };
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger("Auth");
  private readonly secret: string;

  constructor(private readonly mongo: MongoService, private readonly mail: MailService) {
    const secret = process.env.JWT_SECRET ?? "";
    if (secret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters (see .env.example)");
    this.secret = secret;
  }

  /** First start: create the organization admin from ORG_ADMIN_EMAIL / ORG_ADMIN_PASSWORD. */
  async onModuleInit() {
    await this.mongo.ready;
    const { ORG_ADMIN_EMAIL: email, ORG_ADMIN_PASSWORD: password } = process.env;
    if (!email || !password || (await this.mongo.orgUsers.countDocuments()) > 0) return;
    await this.createOrgUser({ name: process.env.ORG_ADMIN_NAME ?? "Organization Admin", email, password, role: "admin" });
    this.log.log(`created organization admin ${email}`);
  }

  private issue(user: AuthUser) {
    const payload: TokenPayload = { sub: user.id, role: user.role, ...(user.mustChangePassword ? { temp: true } : {}) };
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as SignOptions["expiresIn"];
    return { token: sign(payload, this.secret, { expiresIn }), user };
  }

  verify(token: string): TokenPayload {
    try {
      return verify(token, this.secret, { algorithms: ["HS256"] }) as TokenPayload;
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }
  }

  private credentials(body: { email?: unknown; password?: unknown }, forNewAccount: boolean) {
    const email = str(body?.email).toLowerCase();
    const password = typeof body?.password === "string" ? body.password : "";
    if (!EMAIL.test(email)) throw new BadRequestException("a valid email is required");
    if (!password) throw new BadRequestException("password is required");
    if (forNewAccount && (password.length < 8 || password.length > 72)) {
      throw new BadRequestException("password must be 8 to 72 characters");
    }
    return { email, password };
  }

  async registerDonor(body: Record<string, unknown>) {
    const { email, password } = this.credentials(body, true);
    const name = str(body.name);
    if (!name) throw new BadRequestException("name is required");
    const now = new Date();
    const doc: DonorDoc = {
      _id: new ObjectId(), name, email, passwordHash: await hash(password, 12),
      phone: str(body.phone, 30), address: str(body.address, 300), district: str(body.district, 60),
      createdAt: now, updatedAt: now,
    };
    await this.mongo.donors.insertOne(doc).catch(duplicateEmail);
    return this.issue(donorUser(doc));
  }

  private users(kind: AccountKind) {
    return (kind === "donor" ? this.mongo.donors : this.mongo.orgUsers) as unknown as Collection<DonorDoc | OrgUserDoc>;
  }
  private static user(doc: DonorDoc | OrgUserDoc): AuthUser {
    return "role" in doc ? orgUser(doc) : donorUser(doc);
  }

  /** Sign in with the real password, or with a temporary one that has not expired (then a new password must be chosen). */
  private async login(kind: AccountKind, body: Record<string, unknown>) {
    const { email, password } = this.credentials(body, false);
    const doc = await this.users(kind).findOne({ email });
    if ((await compare(password, doc?.passwordHash ?? DUMMY_HASH)) && doc) {
      if (doc.temp) await this.users(kind).updateOne({ _id: doc._id }, { $unset: { temp: "" } }); // not needed after all
      return this.issue(AuthService.user(doc));
    }
    if (doc?.temp && (await compare(password, doc.temp.hash))) {
      if (doc.temp.expires < new Date()) {
        throw new UnauthorizedException("this temporary password has expired - use \"Forgot password?\" to get a new one");
      }
      return this.issue({ ...AuthService.user(doc), mustChangePassword: true });
    }
    throw new UnauthorizedException("wrong email or password");
  }

  loginDonor(body: Record<string, unknown>) {
    return this.login("donor", body);
  }

  loginOrg(body: Record<string, unknown>) {
    return this.login("org", body);
  }

  async createOrgUser(body: Record<string, unknown>, extra: Partial<OrgUserDoc> = {}) {
    const { email, password } = this.credentials(body, true);
    const name = str(body.name);
    const role = body.role as OrgRole;
    if (!name) throw new BadRequestException("name is required");
    if (!ORG_ROLES.includes(role)) throw new BadRequestException(`role must be one of ${ORG_ROLES}`);
    const doc: OrgUserDoc = {
      _id: new ObjectId(), name, email, passwordHash: await hash(password, 12), role,
      org: str(body.org) || undefined, district: str(body.district, 60) || undefined, ...extra, createdAt: new Date(),
    };
    await this.mongo.orgUsers.insertOne(doc).catch(duplicateEmail);
    return orgUser(doc);
  }

  /** A password a person can read from an email and type: 10 letters and digits, no look-alikes (0/O, 1/l/I). */
  static tempPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join("");
  }

  /** A password nobody knows, for an account that will be entered with a temporary password first. */
  static unusablePassword() {
    return randomBytes(32).toString("hex");
  }

  /** Give an account a new temporary password, valid for TEMP_PASSWORD_HOURS. Returns it in plain text, once. */
  async newTempPassword(kind: AccountKind, _id: ObjectId) {
    const password = AuthService.tempPassword();
    const now = new Date();
    const temp = { hash: await hash(password, 12), issuedAt: now, expires: new Date(+now + TEMP_HOURS * 3_600_000) };
    await this.users(kind).updateOne({ _id }, { $set: { temp } });
    return { password, hours: TEMP_HOURS };
  }

  /**
   * "Forgot password?": email a temporary password. The answer is the same whether or not the account exists, and
   * the real password keeps working, so this cannot be used to find accounts or to lock someone out.
   */
  async forgotPassword(kind: AccountKind, body: Record<string, unknown>) {
    const email = str(body?.email).toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException("a valid email is required");
    const doc = await this.users(kind).findOne({ email });
    const recent = doc?.temp && +new Date() - +doc.temp.issuedAt < 60_000; // at most one email a minute per account
    if (doc && !recent) {
      const { password, hours } = await this.newTempPassword(kind, doc._id);
      const collector = "role" in doc && doc.role === "collector";
      const sent = await this.mail.passwordReset({ name: doc.name, email, kind, collector }, password, hours);
      if (!sent) this.log.warn(`password reset for ${email} could not be emailed`);
    }
    return { ok: true };
  }

  /**
   * Set a new password. Someone who signed in with a temporary password only gives the new one; anyone else must
   * also give their current password. Returns a fresh { token, user }.
   */
  async changePassword(payload: TokenPayload, body: Record<string, unknown>) {
    const next = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (next.length < 8 || next.length > 72) throw new BadRequestException("password must be 8 to 72 characters");
    const _id = new ObjectId(payload.sub);
    const users = this.users(payload.role === "donor" ? "donor" : "org");
    const doc = await users.findOne({ _id });
    if (!doc) throw new UnauthorizedException("account no longer exists");
    if (payload.temp) {
      if (!doc.temp || doc.temp.expires < new Date()) throw new UnauthorizedException("this temporary password has expired");
      if (await compare(next, doc.temp.hash)) throw new BadRequestException("choose a password different from the temporary one");
    } else if (!(await compare(String(body?.currentPassword ?? ""), doc.passwordHash))) {
      throw new UnauthorizedException("current password is wrong");
    } else if (await compare(next, doc.passwordHash)) {
      throw new BadRequestException("choose a password different from the current one");
    }
    await users.updateOne({ _id }, { $set: { passwordHash: await hash(next, 12) }, $unset: { temp: "" } });
    return this.issue(AuthService.user(doc));
  }

  /** Current account behind a token; fails if it was deleted after the token was issued. */
  async me(payload: TokenPayload): Promise<AuthUser> {
    if (!ObjectId.isValid(payload.sub)) throw new UnauthorizedException();
    const _id = new ObjectId(payload.sub);
    const doc = await this.users(payload.role === "donor" ? "donor" : "org").findOne({ _id });
    if (!doc) throw new UnauthorizedException("account no longer exists");
    return { ...AuthService.user(doc), ...(payload.temp ? { mustChangePassword: true } : {}) };
  }
}

function duplicateEmail(e: { code?: number }): never {
  if (e.code === 11000) throw new ConflictException("an account with this email already exists");
  throw e;
}
