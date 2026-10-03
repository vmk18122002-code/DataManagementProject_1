import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AlertsController } from "./alerts/alerts.controller";
import { AlertsService } from "./alerts/alerts.service";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { CollectorsController } from "./collectors/collectors.controller";
import { DbService } from "./db.service";
import { DonationsController } from "./donations/donations.controller";
import { DonorsController } from "./donors/donors.controller";
import { DropoffController } from "./dropoff/dropoff.controller";
import { MailService } from "./mail.service";
import { MongoService } from "./mongo.service";
import { PredictController } from "./predict/predict.controller";
import { PredictService } from "./predict/predict.service";
import { IngestController } from "./ingest/ingest.controller";
import { IngestService } from "./ingest/ingest.service";

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AlertsController, IngestController, AuthController, DonorsController, DonationsController, PredictController, DropoffController, CollectorsController],
  providers: [DbService, MongoService, AlertsService, IngestService, AuthService, AuthGuard, PredictService, MailService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: "10mb" }); // delivery proof photos arrive as base64 data URLs
  app.enableCors({ origin: (process.env.PORTAL_ORIGIN ?? "http://localhost:3000,http://localhost:3001").split(",") });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`ReliefHub API on http://localhost:${port}`);
}
void bootstrap();
