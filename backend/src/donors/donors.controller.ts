import { BadRequestException, Body, Controller, Get, NotFoundException, Patch } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Auth, CurrentUser } from "../auth/auth.guard";
import { TokenPayload, donorUser } from "../auth/auth.service";
import { MongoService } from "../mongo.service";

const EDITABLE = { name: 200, phone: 30, address: 300, district: 60 } as const;

@Controller("donors")
export class DonorsController {
  constructor(private readonly mongo: MongoService) {}

  /** Every registered donor, for the organization portal. */
  @Get()
  @Auth("admin")
  async list() {
    const docs = await this.mongo.donors.find({}, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).toArray();
    return docs.map((d) => ({ ...donorUser(d), createdAt: d.createdAt }));
  }

  @Get("me")
  @Auth("donor")
  async me(@CurrentUser() user: TokenPayload) {
    const doc = await this.mongo.donors.findOne({ _id: new ObjectId(user.sub) });
    if (!doc) throw new NotFoundException();
    return donorUser(doc);
  }

  /** Update the donor's own profile: any of { name, phone, address, district }. */
  @Patch("me")
  @Auth("donor")
  async update(@CurrentUser() user: TokenPayload, @Body() body: Record<string, unknown>) {
    const set: Record<string, string> = {};
    for (const [key, max] of Object.entries(EDITABLE)) {
      const v = body?.[key];
      if (v === undefined) continue;
      if (typeof v !== "string") throw new BadRequestException(`${key} must be text`);
      set[key] = v.trim().slice(0, max);
    }
    if (set.name === "") throw new BadRequestException("name cannot be empty");
    const doc = await this.mongo.donors.findOneAndUpdate(
      { _id: new ObjectId(user.sub) }, { $set: { ...set, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!doc) throw new NotFoundException();
    return donorUser(doc);
  }
}
