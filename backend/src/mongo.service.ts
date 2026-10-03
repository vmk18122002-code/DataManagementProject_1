import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Collection, Db, MongoClient, ObjectId } from "mongodb";
import { DonationEvent, DonationStatus, DonationItem, OrgRole, Proof } from "./types";

/**
 * A temporary password (collector invitation or "forgot password"). It works beside the real password until it
 * expires or the account chooses a new password, so asking for one never locks the real owner out.
 */
export interface TempPassword {
  hash: string;
  expires: Date;
  issuedAt: Date;
}

export interface DonorDoc {
  _id: ObjectId;
  name: string;
  email: string;          // lower case, unique
  passwordHash: string;
  temp?: TempPassword;
  phone: string;
  address: string;
  district: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgUserDoc {
  _id: ObjectId;
  name: string;
  email: string;          // lower case, unique
  passwordHash: string;
  temp?: TempPassword;
  role: OrgRole;
  org?: string;           // collecting organisation, for collectors
  district?: string;
  // collectors only
  phone?: string;
  vehicleType?: string;   // Motorbike | Three-wheeler | Car | Van | Lorry | Tractor
  vehicleNo?: string;
  dropoff?: DropoffRef;   // the drop-off point this collector brings collected items to
  createdAt: Date;
}

/** Copy of a drop-off point kept on a donation or collector, so it stays readable if the point is later removed. */
export interface DropoffRef {
  id: string;
  name: string;
  address: string;
  district: string;
}

export interface DropoffPointDoc {
  _id: ObjectId;
  name: string;
  address: string;
  district: string;
  phone?: string;
  hours?: string;         // opening hours, free text
  createdAt: Date;
}

export interface DonationDoc {
  _id: string;            // "DN-1043"
  donorId: ObjectId;
  donor: string;          // contact details given for this pickup (may differ from the account)
  phone: string;
  email: string;
  address: string;
  district: string;
  items: DonationItem[];
  targetDs: string;
  targetDistrict: string;
  // set when the organization sends the donation to another area than the one the donor chose; shown to the donor
  rerouted?: { fromDs: string; fromDistrict: string; reason: string; time: string };
  date: string;           // YYYY-MM-DD
  notes?: string;         // donor's note, item breakdown and other items given
  // set when the donor brings the items to a drop-off point themselves (no collector pickup); a copy, so it
  // stays readable if the point is later removed
  dropoff?: { id: string; name: string; address: string; district: string };
  status: DonationStatus;
  collector?: string;
  proof?: Proof & { org: string };
  areaProof?: Proof & { by: string };
  events?: DonationEvent[]; // oldest first; donations made before this was recorded have none
  createdAt: Date;
  updatedAt: Date;
}

/*
  MongoDB holds accounts (donors, organization members) and donor data (profiles, donations).
  Disaster alerts stay in SQLite (db.service.ts).
*/
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new MongoClient(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017", {
    serverSelectionTimeoutMS: 5_000,
    ignoreUndefined: true,
  });
  private readonly db: Db = this.client.db(process.env.MONGODB_DB ?? "reliefhub");
  /** Resolves once the server is reachable and the indexes exist. Other services await it in their own init. */
  readonly ready: Promise<unknown> = Promise.all([
    this.donors.createIndex({ email: 1 }, { unique: true }),
    this.orgUsers.createIndex({ email: 1 }, { unique: true }),
    this.donations.createIndex({ donorId: 1, createdAt: -1 }),
    this.dropoffPoints.createIndex({ district: 1 }),
  ]);

  async onModuleInit() {
    await this.ready; // stop the API from starting if MongoDB is down
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  get donors(): Collection<DonorDoc> {
    return this.db.collection("donors");
  }
  get orgUsers(): Collection<OrgUserDoc> {
    return this.db.collection("org_users");
  }
  get donations(): Collection<DonationDoc> {
    return this.db.collection("donations");
  }
  get dropoffPoints(): Collection<DropoffPointDoc> {
    return this.db.collection("dropoff_points");
  }

  /** Next number in a named sequence (donation ids). */
  async next(name: string, startAfter: number): Promise<number> {
    const counters = this.db.collection<{ _id: string; seq: number }>("counters");
    await counters.updateOne({ _id: name }, { $setOnInsert: { seq: startAfter } }, { upsert: true });
    const doc = await counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: "after" });
    return doc!.seq;
  }
}
