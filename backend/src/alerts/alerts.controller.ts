import { BadRequestException, Body, Controller, Get, MessageEvent, Param, Patch, Query, Sse } from "@nestjs/common";
import { Observable, interval, map, merge } from "rxjs";
import { Auth } from "../auth/auth.guard";
import { AlertStatus } from "../types";
import { AlertsService } from "./alerts.service";

const STATUSES: AlertStatus[] = ["New", "Confirmed", "Dismissed"];

@Controller("alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@Query("status") status?: AlertStatus) {
    if (status && !STATUSES.includes(status)) throw new BadRequestException(`status must be one of ${STATUSES}`);
    return this.alerts.list(status);
  }

  /** Server-sent events: one message per created / updated alert, plus a ping every 25 s to keep proxies open. */
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    return merge(
      this.alerts.changes.pipe(map((a) => ({ type: "alert", data: a }))),
      interval(25_000).pipe(map(() => ({ type: "ping", data: "" }))),
    );
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.alerts.get(id);
  }

  @Patch(":id/status")
  @Auth("admin")
  setStatus(@Param("id") id: string, @Body() body: { status?: AlertStatus; by?: string }) {
    if (!body?.status || !STATUSES.includes(body.status)) {
      throw new BadRequestException(`body.status must be one of ${STATUSES}`);
    }
    return this.alerts.setStatus(id, body.status, body.by);
  }
}
