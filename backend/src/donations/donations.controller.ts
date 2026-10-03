import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Auth, CurrentUser } from "../auth/auth.guard";
import { TokenPayload } from "../auth/auth.service";
import { DonationDoc, MongoService } from "../mongo.service";
import { DonationEvent, DonationItem, DonationStatus, ItemKey, Proof } from "../types";

const ITEMS: ItemKey[] = ["food", "clothes", "books"];
const STATUSES: DonationStatus[] = [
  "Submitted", "Allocated", "Collector assigned", "Picked up", "Delivered", "Dispatched to area", "Reached area",
];
const MAX_PHOTO = 8_000_000; // characters of base64 data URL (~6 MB image)

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Portal shape: `id` instead of `_id`, donorId as text, no internal timestamps. */
function view({ _id, donorId, createdAt, updatedAt, ...rest }: DonationDoc) {
  return { id: _id, donorId: donorId.toHexString(), ...rest };
}

function proof(v: unknown): Proof {
  const p = (v ?? {}) as Record<string, unknown>;
  const photoUrl = typeof p.photoUrl === "string" ? p.photoUrl : "";
  if (photoUrl && !photoUrl.startsWith("data:image/")) throw new BadRequestException("photoUrl must be an image data URL");
  if (photoUrl.length > MAX_PHOTO) throw new BadRequestException("photo is too large");
  return { photoUrl, note: str(p.note, 1000), time: new Date().toISOString() };
}

@Controller("donations")
export class DonationsController {
  constructor(private readonly mongo: MongoService) {}

  /** A donor gets their own donations; organization members get all of them. */
  @Get()
  @Auth()
  async list(@CurrentUser() user: TokenPayload) {
    const filter = user.role === "donor" ? { donorId: new ObjectId(user.sub) } : {};
    return (await this.mongo.donations.find(filter).sort({ createdAt: -1 }).toArray()).map(view);
  }

  @Post()
  @Auth("donor")
  async create(@CurrentUser() user: TokenPayload, @Body() b: Record<string, unknown>) {
    const items: DonationItem[] = (Array.isArray(b?.items) ? b.items : []).map((i: DonationItem) => ({ item: i?.item, qty: Number(i?.qty) }));
    if (!items.length || items.some((i) => !ITEMS.includes(i.item) || !Number.isInteger(i.qty) || i.qty < 1)) {
      throw new BadRequestException(`items must be [{ item: ${ITEMS.join(" | ")}, qty: whole number above 0 }]`);
    }
    const donor = str(b.donor), phone = str(b.phone, 30), address = str(b.address), district = str(b.district, 60);
    if (!donor || !phone || !district) throw new BadRequestException("donor, phone and district are required");

    // either a collector picks the items up at the donor's address, or the donor brings them to a drop-off point
    let dropoff: DonationDoc["dropoff"];
    const dropoffId = str(b.dropoffId, 24);
    if (dropoffId) {
      const point = ObjectId.isValid(dropoffId) ? await this.mongo.dropoffPoints.findOne({ _id: new ObjectId(dropoffId) }) : null;
      if (!point) throw new BadRequestException("that drop-off point no longer exists");
      dropoff = { id: dropoffId, name: point.name, address: point.address, district: point.district };
    } else if (!address) {
      throw new BadRequestException("a pickup address or a drop-off point is required");
    }
    const date = str(b.date, 10) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("date must be YYYY-MM-DD");
    const targetDs = str(b.targetDs, 100), targetDistrict = str(b.targetDistrict, 60);

    const now = new Date();
    const doc: DonationDoc = {
      _id: `DN-${await this.mongo.next("donation", 1042)}`,
      donorId: new ObjectId(user.sub),
      donor, phone, email: str(b.email).toLowerCase(), address, district, items, targetDs, targetDistrict, date,
      notes: str(b.notes, 2000) || undefined,
      dropoff,
      status: targetDs ? "Allocated" : "Submitted",
      events: [{ kind: "Submitted", time: now.toISOString(), text: "Your donation was received." }],
      createdAt: now, updatedAt: now,
    };
    await this.mongo.donations.insertOne(doc);
    return view(doc);
  }

  /** Organization members move a donation along: any of { status, collector, targetDs, targetDistrict, rerouteReason, proof, areaProof }. */
  @Patch(":id")
  @Auth("admin", "collector")
  async update(@Param("id") id: string, @Body() b: Record<string, unknown>) {
    const set: Partial<DonationDoc> = {};
    if (b?.status !== undefined) {
      if (!STATUSES.includes(b.status as DonationStatus)) throw new BadRequestException(`status must be one of ${STATUSES}`);
      set.status = b.status as DonationStatus;
    }
    if (b?.collector !== undefined) set.collector = str(b.collector);
    if (b?.targetDs !== undefined) set.targetDs = str(b.targetDs, 100);
    if (b?.targetDistrict !== undefined) set.targetDistrict = str(b.targetDistrict, 60);
    if (b?.proof !== undefined) set.proof = { ...proof(b.proof), org: str((b.proof as { org?: unknown })?.org) };
    if (b?.areaProof !== undefined) set.areaProof = { ...proof(b.areaProof), by: str((b.areaProof as { by?: unknown })?.by) };
    if (!Object.keys(set).length) throw new BadRequestException("nothing to update");

    const old = await this.mongo.donations.findOne({ _id: id });
    if (!old) throw new NotFoundException(`no donation ${id}`);
    const now = new Date(), time = now.toISOString();
    const ds = set.targetDs ?? old.targetDs, district = set.targetDistrict ?? old.targetDistrict;
    const area = `${ds}, ${district}`;
    const events: DonationEvent[] = []; // what the donor is told about this change

    // a new target area: remember the area the donor chose (however often it is re-routed), forget it when sent back there
    let forget = false;
    if (ds !== old.targetDs || district !== old.targetDistrict) {
      const fromDs = old.rerouted?.fromDs ?? old.targetDs, fromDistrict = old.rerouted?.fromDistrict ?? old.targetDistrict;
      if (fromDs && (fromDs !== ds || fromDistrict !== district)) {
        const reason = str(b.rerouteReason, 300);
        set.rerouted = { fromDs, fromDistrict, reason, time };
        events.push({ kind: "Re-routed", time, text: `Now going to ${area} instead of ${fromDs}, ${fromDistrict}${reason ? `: ${reason}` : "."}` });
      } else if (old.rerouted) {
        forget = true;
        events.push({ kind: "Re-routed", time, text: `Going to ${area} again, the area you chose.` });
      }
    }

    if (set.status && set.status !== old.status) {
      const collector = set.collector ?? old.collector;
      const text: Record<DonationStatus, string> = {
        "Submitted": "Your donation was received.",
        "Allocated": `Allocated to ${area}.`,
        "Collector assigned": `${collector || "A collector"} was assigned to collect your items.`,
        "Picked up": `Your items were picked up${collector ? ` by ${collector}` : ""}.`,
        "Delivered": "Your items arrived at the organization's store room.",
        "Dispatched to area": `Your items are on the way to ${area}.`,
        "Reached area": `Your items reached ${area}.`,
      };
      events.push({ kind: set.status, time, text: text[set.status] });
    }

    const doc = await this.mongo.donations.findOneAndUpdate(
      { _id: id },
      {
        $set: { ...set, updatedAt: now },
        ...(forget ? { $unset: { rerouted: "" } } : {}),
        ...(events.length ? { $push: { events: { $each: events } } } : {}),
      },
      { returnDocument: "after" });
    if (!doc) throw new NotFoundException(`no donation ${id}`);
    return view(doc);
  }
}
