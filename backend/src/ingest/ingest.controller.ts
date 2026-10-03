import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { Auth } from "../auth/auth.guard";
import { SourceName } from "../types";
import { fromText } from "./extract";
import { IngestService } from "./ingest.service";

const WORKER_SOURCES: SourceName[] = ["DMC", "Met Department", "NBRO", "RISE Sri Lanka"];

@Controller()
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Get("sources")
  sources() {
    return this.ingest.sourceStatus();
  }

  /** "Fetch alerts" button. Optional { from, to } (YYYY-MM-DD) to back-fill a past window. */
  @Post("ingest/run")
  @Auth("admin")
  run(@Body() body: { from?: string; to?: string } = {}) {
    const from = body.from ? new Date(body.from) : undefined;
    const to = body.to ? new Date(body.to) : undefined;
    if ((from && isNaN(+from)) || (to && isNaN(+to))) throw new BadRequestException("from / to must be YYYY-MM-DD");
    return this.ingest.run(from, to);
  }

  /** For workers (DMC PDF parser, Met / NBRO scrapers): send report text, the API extracts the alert. */
  @Post("raw-items")
  rawItem(@Headers("x-api-key") key: string | undefined,
          @Body() b: { source?: SourceName; externalId?: string; text?: string; issuedAt?: string; url?: string }) {
    if (!process.env.INGEST_API_KEY || key !== process.env.INGEST_API_KEY) throw new UnauthorizedException();
    if (!b?.source || !WORKER_SOURCES.includes(b.source) || !b.externalId || !b.text) {
      throw new BadRequestException(`need source (${WORKER_SOURCES.join(" | ")}), externalId and text`);
    }
    const extracted = fromText(b.source, b.externalId, b.text, b.issuedAt, b.url);
    return this.ingest.ingestExternal(b.source, b.externalId, b, extracted, b.url);
  }
}
