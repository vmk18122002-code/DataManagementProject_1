import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Auth } from "../auth/auth.guard";
import { DropoffPointDoc, MongoService } from "../mongo.service";

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function pointView({ _id, createdAt, ...rest }: DropoffPointDoc) {
  return { id: _id.toHexString(), ...rest };
}

/*
  Drop-off points: places run by the organisation where a donor can hand in items themselves,
  instead of waiting for a collector. Organization admins manage the list.
*/
@Controller("dropoff-points")
export class DropoffController {
  constructor(private readonly mongo: MongoService) {}

  /** All points, or only those in one district: /dropoff-points?district=Kandy */
  @Get()
  @Auth()
  async list(@Query("district") district?: string) {
    const docs = await this.mongo.dropoffPoints.find(district ? { district } : {}).sort({ district: 1, name: 1 }).toArray();
    return docs.map(pointView);
  }

  /** { name, address, district, phone?, hours? } */
  @Post()
  @Auth("admin")
  async create(@Body() b: Record<string, unknown>) {
    const name = str(b?.name), address = str(b?.address, 300), district = str(b?.district, 60);
    if (!name || !address || !district) throw new BadRequestException("name, address and district are required");
    const doc: DropoffPointDoc = {
      _id: new ObjectId(), name, address, district,
      phone: str(b.phone, 30) || undefined, hours: str(b.hours, 100) || undefined, createdAt: new Date(),
    };
    await this.mongo.dropoffPoints.insertOne(doc);
    return pointView(doc);
  }

  /** Donations already made keep their own copy of the point's name and address. */
  @Delete(":id")
  @Auth("admin")
  async remove(@Param("id") id: string) {
    if (!ObjectId.isValid(id)) throw new NotFoundException();
    const { deletedCount } = await this.mongo.dropoffPoints.deleteOne({ _id: new ObjectId(id) });
    if (!deletedCount) throw new NotFoundException();
    return { id };
  }
}
