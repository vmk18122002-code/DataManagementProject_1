import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Auth } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { DISTRICT_XY, km } from "../geo";
import { MailService } from "../mail.service";
import { DropoffPointDoc, MongoService, OrgUserDoc } from "../mongo.service";

export const VEHICLES = ["Motorbike", "Three-wheeler", "Car", "Van", "Lorry", "Tractor"];
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** What the portals show about a collector (no email, no password hash). */
function view(u: OrgUserDoc) {
  return {
    id: u._id.toHexString(), name: u.name, org: u.org ?? "", district: u.district ?? "", phone: u.phone ?? "",
    vehicleType: u.vehicleType ?? "", vehicleNo: u.vehicleNo ?? "", dropoff: u.dropoff,
  };
}

/*
  Collectors are organization accounts with the role "collector". An admin adds them with their district, vehicle
  and the drop-off point they bring collected items to.
*/
@Controller("collectors")
export class CollectorsController {
  constructor(private readonly mongo: MongoService, private readonly auth: AuthService, private readonly mail: MailService) {}

  /** Donors see the collector assigned to them, admins assign from this list. */
  @Get()
  @Auth()
  async list() {
    return (await this.mongo.orgUsers.find({ role: "collector" }).sort({ district: 1, name: 1 }).toArray()).map(view);
  }

  /**
   * { name, email, org, district, phone, vehicleType, vehicleNo? }
   * The collector delivers to the drop-off point in their district, or the nearest one when their district has none.
   * The collector gets a temporary password by email and must choose their own at first sign-in. If the email
   * could not be sent, the temporary password comes back in the response so the admin can pass it on.
   */
  @Post()
  @Auth("admin")
  async create(@Body() b: Record<string, unknown>) {
    const district = str(b?.district, 60), phone = str(b?.phone, 30), vehicleType = str(b?.vehicleType, 30);
    if (!district || !phone) throw new BadRequestException("district and phone are required");
    if (!VEHICLES.includes(vehicleType)) throw new BadRequestException(`vehicleType must be one of ${VEHICLES}`);
    const point = await this.nearestPoint(district);
    if (!point) throw new BadRequestException("add a drop-off point first: a collector needs a place to bring the items");

    const user = await this.auth.createOrgUser({ ...b, role: "collector", password: AuthService.unusablePassword() }, {
      phone, vehicleType, vehicleNo: str(b.vehicleNo, 20) || undefined,
      dropoff: { id: point._id.toHexString(), name: point.name, address: point.address, district: point.district },
    });
    return this.invite(new ObjectId(user.id));
  }

  /** Send the invitation again with a fresh temporary password (the old one expired, or the email was lost). */
  @Post(":id/invite")
  @Auth("admin")
  resend(@Param("id") id: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    return this.invite(new ObjectId(id));
  }

  /** A drop-off point in the district, otherwise the one in the closest district. */
  private async nearestPoint(district: string): Promise<DropoffPointDoc | undefined> {
    const points = await this.mongo.dropoffPoints.find().sort({ name: 1 }).toArray();
    const from = DISTRICT_XY[district];
    const far = (p: DropoffPointDoc) => {
      if (p.district === district) return 0;
      const to = DISTRICT_XY[p.district];
      return from && to ? km(from[0], from[1], to[0], to[1]) : Infinity;
    };
    return points.sort((a, b) => far(a) - far(b))[0];
  }

  private async invite(_id: ObjectId) {
    const doc = await this.mongo.orgUsers.findOne({ _id, role: "collector" });
    if (!doc) throw new NotFoundException();
    const { password, hours } = await this.auth.newTempPassword("org", _id);
    const emailSent = await this.mail.collectorInvite({
      name: doc.name, email: doc.email, district: doc.district ?? "", org: doc.org ?? "",
      dropoff: doc.dropoff ? `${doc.dropoff.name}, ${doc.dropoff.address}` : "your drop-off point",
    }, password, hours);
    return { collector: view(doc), email: doc.email, emailSent, validHours: hours, ...(emailSent ? {} : { tempPassword: password }) };
  }

  /** Removes the collector's account. Donations they handled keep their name. */
  @Delete(":id")
  @Auth("admin")
  async remove(@Param("id") id: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    const { deletedCount } = await this.mongo.orgUsers.deleteOne({ _id: new ObjectId(id), role: "collector" });
    if (!deletedCount) throw new NotFoundException();
    return { id };
  }
}
